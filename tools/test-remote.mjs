#!/usr/bin/env node
/**
 * End-to-end check of the phone-as-remote Durable Object.
 *
 * Verifies the guarantees the room is supposed to enforce:
 *   1. A phone cannot join a room with no TV in it.
 *   2. An unauthenticated client cannot claim the TV role.
 *   3. A real TV + phone pair exchange peer counts.
 *   4. A phone's button press arrives at the TV.
 *   5. A phone cannot spoof TV state (only the TV may send `state`).
 *   6. Garbage actions are dropped rather than relayed.
 *
 * Usage:  node tools/test-remote.mjs [baseUrl] [cookieFile]
 */

import { readFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:8787';
const COOKIE_FILE = process.argv[3] ?? '/tmp/ck.txt';
const WS_BASE = BASE.replace(/^http/, 'ws');

/** Pull the session cookie out of a curl Netscape jar. */
function readCookie() {
  const jar = readFileSync(COOKIE_FILE, 'utf8');
  const line = jar.split('\n').find((l) => l.includes('hearth_sid'));
  if (!line) throw new Error(`No hearth_sid cookie in ${COOKIE_FILE}`);
  const parts = line.split('\t');
  return `hearth_sid=${parts[parts.length - 1].trim()}`;
}

const cookie = readCookie();
let failures = 0;

function check(label, ok, detail = '') {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

function open(url, headers = {}) {
  // Node's global WebSocket is undici's, which accepts a `headers` option.
  const socket = new WebSocket(url, { headers });
  const inbox = [];
  const waiters = [];
  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data));
    const waiter = waiters.shift();
    if (waiter) waiter(msg);
    else inbox.push(msg);
  });
  return {
    socket,
    opened: new Promise((resolve, reject) => {
      socket.addEventListener('open', () => resolve(true));
      socket.addEventListener('error', () => reject(new Error('socket error')));
      socket.addEventListener('close', (e) => reject(new Error(`closed ${e.code}`)));
    }),
    send: (msg) => socket.send(JSON.stringify(msg)),
    /** Waits for the next message matching a predicate, with a timeout. */
    next: (predicate = () => true, ms = 2500) =>
      new Promise((resolve, reject) => {
        const existing = inbox.findIndex(predicate);
        if (existing >= 0) return resolve(inbox.splice(existing, 1)[0]);
        const timer = setTimeout(() => reject(new Error('timed out waiting for message')), ms);
        const tryWaiter = (msg) => {
          if (predicate(msg)) {
            clearTimeout(timer);
            resolve(msg);
          } else {
            waiters.push(tryWaiter);
          }
        };
        waiters.push(tryWaiter);
      }),
    close: () => socket.close(),
  };
}

async function main() {
  console.log(`Testing remote pairing against ${BASE}\n`);

  // --- 1. Ask the server for a pairing code -----------------------------
  const sessionRes = await fetch(`${BASE}/api/remote/session`, {
    method: 'POST',
    headers: { cookie },
  });
  if (!sessionRes.ok) throw new Error(`session failed: ${sessionRes.status}`);
  const { code } = await sessionRes.json();
  console.log(`Pairing code: ${code}\n`);
  check('code is 8 unambiguous characters', /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(code));

  // --- 2. A phone must not be able to join an empty room ----------------
  const orphan = open(`${WS_BASE}/api/remote/socket?code=${code}&role=phone`);
  let orphanRejected = false;
  try {
    await orphan.opened;
  } catch {
    orphanRejected = true;
  }
  check('phone is refused when no TV is listening', orphanRejected);
  orphan.close();

  // --- 3. An unauthenticated client must not claim the TV role ----------
  const impostor = open(`${WS_BASE}/api/remote/socket?code=${code}&role=tv`);
  let impostorRejected = false;
  try {
    await impostor.opened;
  } catch {
    impostorRejected = true;
  }
  check('unauthenticated client cannot claim the TV role', impostorRejected);
  impostor.close();

  // --- 4. The real TV joins --------------------------------------------
  const tv = open(`${WS_BASE}/api/remote/socket?code=${code}&role=tv`, { cookie });
  await tv.opened;
  check('authenticated TV joins the room', true);

  // --- 5. The phone joins ----------------------------------------------
  const phone = open(`${WS_BASE}/api/remote/socket?code=${code}&role=phone`);
  await phone.opened;
  const peers = await tv.next((m) => m.t === 'peers' && m.phones > 0);
  check('TV is told a phone connected', peers.phones === 1, `phones=${peers.phones}`);

  // --- 6. A button press reaches the TV --------------------------------
  phone.send({ t: 'action', action: 'select' });
  const action = await tv.next((m) => m.t === 'action');
  check('phone button press arrives at the TV', action.action === 'select', `got ${action.action}`);

  phone.send({ t: 'action', action: 'right', repeat: true });
  const repeated = await tv.next((m) => m.t === 'action');
  check('repeat flag is preserved', repeated.action === 'right' && repeated.repeat === true);

  // --- 7. Invalid actions are dropped ----------------------------------
  phone.send({ t: 'action', action: 'formatHardDrive' });
  phone.send({ t: 'action', action: 'up' });
  const afterGarbage = await tv.next((m) => m.t === 'action');
  check('unknown actions are dropped, not relayed', afterGarbage.action === 'up', `got ${afterGarbage.action}`);

  // --- 8. Only the TV may broadcast state ------------------------------
  phone.send({ t: 'state', title: 'spoofed' });
  tv.send({ t: 'state', title: 'Real Title', playing: true });
  const state = await phone.next((m) => m.t === 'state');
  check('TV state reaches the phone', state.title === 'Real Title', `got ${state.title}`);

  let spoofed = false;
  try {
    await phone.next((m) => m.t === 'state' && m.title === 'spoofed', 600);
    spoofed = true;
  } catch {
    spoofed = false;
  }
  check('a phone cannot spoof TV state', !spoofed);

  // --- 9. Text hand-off ------------------------------------------------
  phone.send({ t: 'text', value: 'super-secret-webdav-password' });
  const text = await tv.next((m) => m.t === 'text');
  check('typed text reaches the TV', text.value === 'super-secret-webdav-password');

  tv.close();
  phone.close();

  console.log(`\n${failures === 0 ? 'All remote-pairing checks passed.' : `${failures} check(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nTest run failed:', err.message);
  process.exit(1);
});
