/// <reference types="@cloudflare/workers-types" />

import { REMOTE_ACTIONS, type RemoteSocketMessage } from '../shared/types';
import type { Env } from './env';

/**
 * One Durable Object instance per pairing code. It is a tiny, strictly-typed
 * message relay between the TV tab and any phones acting as its remote.
 *
 * Hibernatable WebSockets are used so an idle room costs nothing: the object
 * can be evicted from memory while the sockets stay open, and Cloudflare
 * revives it on the next message.
 */

const TAG_TV = 'tv';
const TAG_PHONE = 'phone';
const MAX_PHONES = 4;
/** Rooms are only joinable for this long after the TV opens them. */
const PAIR_WINDOW_MS = 15 * 60 * 1000;

interface RoomMeta {
  createdAt: number;
  joins: number;
}

export class RemoteRoom {
  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {
    void this.env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const role = url.searchParams.get('role') === 'tv' ? TAG_TV : TAG_PHONE;

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade.', { status: 426 });
    }

    const meta =
      (await this.state.storage.get<RoomMeta>('meta')) ?? { createdAt: Date.now(), joins: 0 };

    if (role === TAG_TV) {
      // A TV (re)claiming the room restarts the pairing window.
      meta.createdAt = Date.now();
      // Only one TV per code: replace any stale one.
      for (const ws of this.state.getWebSockets(TAG_TV)) {
        try {
          ws.close(1000, 'replaced by a newer TV session');
        } catch {
          /* already gone */
        }
      }
    } else {
      if (!this.state.getWebSockets(TAG_TV).length) {
        return new Response('That code is not active. Open the pairing screen on your TV again.', {
          status: 409,
        });
      }
      if (Date.now() - meta.createdAt > PAIR_WINDOW_MS) {
        return new Response('That pairing code has expired. Generate a new one on the TV.', {
          status: 410,
        });
      }
      if (this.state.getWebSockets(TAG_PHONE).length >= MAX_PHONES) {
        return new Response('Too many remotes are already paired with this TV.', { status: 429 });
      }
      // Cheap brute-force ceiling on code guessing.
      meta.joins += 1;
      if (meta.joins > 40) {
        return new Response('This pairing code has been retired for safety.', { status: 429 });
      }
    }

    await this.state.storage.put('meta', meta);

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.state.acceptWebSocket(server, [role]);
    this.announcePeers();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') return;

    let msg: RemoteSocketMessage;
    try {
      msg = JSON.parse(raw) as RemoteSocketMessage;
    } catch {
      return;
    }

    const isTv = this.state.getTags(ws).includes(TAG_TV);

    switch (msg.t) {
      case 'ping':
        this.send(ws, { t: 'pong' });
        return;

      case 'action': {
        // Only phones drive the TV, and only with actions we recognise.
        if (isTv) return;
        if (!REMOTE_ACTIONS.includes(msg.action)) return;
        this.broadcast(TAG_TV, { t: 'action', action: msg.action, repeat: msg.repeat === true });
        return;
      }

      case 'text': {
        if (isTv) return;
        if (typeof msg.value !== 'string') return;
        this.broadcast(TAG_TV, { t: 'text', value: msg.value.slice(0, 200) });
        return;
      }

      case 'pointer': {
        if (isTv) return;
        if (!Number.isFinite(msg.dx) || !Number.isFinite(msg.dy)) return;
        this.broadcast(TAG_TV, { t: 'pointer', dx: msg.dx, dy: msg.dy });
        return;
      }

      case 'state': {
        // The TV mirrors what is on screen back to the phone.
        if (!isTv) return;
        this.broadcast(TAG_PHONE, msg);
        return;
      }

      default:
        return;
    }
  }

  async webSocketClose(_ws: WebSocket, _code: number, _reason: string, _clean: boolean): Promise<void> {
    this.announcePeers();
  }

  async webSocketError(): Promise<void> {
    this.announcePeers();
  }

  private send(ws: WebSocket, msg: RemoteSocketMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket closed mid-send */
    }
  }

  private broadcast(tag: string, msg: RemoteSocketMessage): void {
    const payload = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets(tag)) {
      try {
        ws.send(payload);
      } catch {
        /* skip dead sockets */
      }
    }
  }

  /** Lets both ends render an honest "connected / waiting" state. */
  private announcePeers(): void {
    const tv = this.state.getWebSockets(TAG_TV).length > 0;
    const phones = this.state.getWebSockets(TAG_PHONE).length;
    const msg: RemoteSocketMessage = { t: 'peers', tv, phones };
    this.broadcast(TAG_TV, msg);
    this.broadcast(TAG_PHONE, msg);
  }
}

/** Unambiguous alphabet: no 0/O, no 1/I/L. Safe to read aloud. */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function newPairingCode(length = 8): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

export function isPairingCode(v: string): boolean {
  return /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6,12}$/.test(v);
}
