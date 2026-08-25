/**
 * Phone-pairing rooms for the self-hosted server.
 *
 * On Cloudflare each pairing code gets its own Durable Object, which is how you
 * get a consistent rendezvous point across a global edge network. A single Node
 * process needs none of that machinery: one in-memory map is both sufficient and
 * strictly simpler.
 *
 * The security properties are kept identical to `server/remote.ts`, because they
 * are what make "scan a QR code and start controlling the TV" safe:
 *   - a phone cannot join a room with no TV in it
 *   - the TV role requires a valid session
 *   - rooms are only joinable for a limited window
 *   - a phone cannot spoof what the TV reports as playing
 */

import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { REMOTE_ACTIONS, type RemoteSocketMessage } from '../shared/types.ts';

const MAX_PHONES = 4;
const PAIR_WINDOW_MS = 15 * 60 * 1000;
const MAX_JOINS = 40;

interface Room {
  code: string;
  createdAt: number;
  joins: number;
  tv: WebSocket | null;
  phones: Set<WebSocket>;
}

const rooms = new Map<string, Room>();

function roomFor(code: string): Room {
  let room = rooms.get(code);
  if (!room) {
    room = { code, createdAt: Date.now(), joins: 0, tv: null, phones: new Set() };
    rooms.set(code, room);
  }
  return room;
}

function send(socket: WebSocket, message: RemoteSocketMessage): void {
  try {
    socket.send(JSON.stringify(message));
  } catch {
    /* socket closed mid-send */
  }
}

function announce(room: Room): void {
  const message: RemoteSocketMessage = {
    t: 'peers',
    tv: room.tv !== null,
    phones: room.phones.size,
  };
  if (room.tv) send(room.tv, message);
  for (const phone of room.phones) send(phone, message);
}

function dispose(room: Room): void {
  if (!room.tv && room.phones.size === 0) rooms.delete(room.code);
}

export interface JoinRejection {
  status: number;
  reason: string;
}

/** Decides whether a phone may join, mirroring the Durable Object's rules. */
export function checkPhoneJoin(code: string): JoinRejection | null {
  const room = rooms.get(code);
  if (!room || !room.tv) {
    return { status: 409, reason: 'That code is not active. Open the pairing screen on your TV again.' };
  }
  if (Date.now() - room.createdAt > PAIR_WINDOW_MS) {
    return { status: 410, reason: 'That pairing code has expired. Generate a new one on the TV.' };
  }
  if (room.phones.size >= MAX_PHONES) {
    return { status: 429, reason: 'Too many remotes are already paired with this TV.' };
  }
  room.joins += 1;
  if (room.joins > MAX_JOINS) {
    return { status: 429, reason: 'This pairing code has been retired for safety.' };
  }
  return null;
}

export function attachTv(code: string, socket: WebSocket): void {
  const room = roomFor(code);
  // A TV reclaiming the code restarts the pairing window and replaces any stale
  // session, so reloading the page does not orphan the room.
  room.createdAt = Date.now();
  if (room.tv && room.tv !== socket) {
    try {
      room.tv.close(1000, 'replaced by a newer TV session');
    } catch {
      /* already gone */
    }
  }
  room.tv = socket;
  wire(room, socket, true);
  announce(room);
}

export function attachPhone(code: string, socket: WebSocket): void {
  const room = roomFor(code);
  room.phones.add(socket);
  wire(room, socket, false);
  announce(room);
}

function wire(room: Room, socket: WebSocket, isTv: boolean): void {
  socket.on('message', (raw: Buffer | string) => {
    let message: RemoteSocketMessage;
    try {
      message = JSON.parse(String(raw)) as RemoteSocketMessage;
    } catch {
      return;
    }

    switch (message.t) {
      case 'ping':
        send(socket, { t: 'pong' });
        return;

      case 'action': {
        // Only phones drive the TV, and only with actions we recognise.
        if (isTv || !room.tv) return;
        if (!REMOTE_ACTIONS.includes(message.action)) return;
        send(room.tv, { t: 'action', action: message.action, repeat: message.repeat === true });
        return;
      }

      case 'text': {
        if (isTv || !room.tv) return;
        if (typeof message.value !== 'string') return;
        send(room.tv, { t: 'text', value: message.value.slice(0, 200) });
        return;
      }

      case 'pointer': {
        if (isTv || !room.tv) return;
        if (!Number.isFinite(message.dx) || !Number.isFinite(message.dy)) return;
        send(room.tv, { t: 'pointer', dx: message.dx, dy: message.dy });
        return;
      }

      case 'state': {
        // Only the TV may say what is on screen.
        if (!isTv) return;
        for (const phone of room.phones) send(phone, message);
        return;
      }

      default:
        return;
    }
  });

  const detach = () => {
    if (isTv && room.tv === socket) room.tv = null;
    else room.phones.delete(socket);
    announce(room);
    dispose(room);
  };

  socket.on('close', detach);
  socket.on('error', detach);
}

/** Unambiguous alphabet: no 0/O, no 1/I/L. Safe to read aloud. */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function newPairingCode(length = 8): string {
  const bytes = Buffer.from(randomUUID().replace(/-/g, ''), 'hex');
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

export function isPairingCode(value: string): boolean {
  return /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6,12}$/.test(value);
}

/** Drops rooms nobody is using, so a long-running process cannot leak them. */
export function pruneRooms(): void {
  for (const room of [...rooms.values()]) {
    if (!room.tv && room.phones.size === 0) rooms.delete(room.code);
  }
}
