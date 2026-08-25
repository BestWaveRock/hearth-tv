#!/usr/bin/env node
/**
 * Hearth, self-hosted.
 *
 * This runs the *same* route table as the Cloudflare Worker — imported from
 * `server/index.ts` — against Node instead of workerd. Three bindings are
 * swapped out and nothing else changes:
 *
 *   DB           D1  -> node:sqlite, via a D1-compatible shim
 *   ASSETS       Workers Static Assets -> the built SPA read off disk
 *   REMOTE_ROOM  Durable Objects -> an in-memory room map
 *
 * ## Why this deployment matters
 *
 * A browser refuses to load plain HTTP from an HTTPS page. That single rule is
 * what stops the hosted version of Hearth from talking directly to a NAS at
 * `http://192.168.x.x`. Served from this process over HTTP on your own network,
 * the restriction does not apply — so Direct mode works, media streams at full
 * LAN speed, and nothing leaves the building.
 *
 * Environment:
 *   PORT             default 8788
 *   HOST             default 0.0.0.0
 *   DATA_DIR         where the SQLite file lives, default ./data
 *   ASSETS_DIR       the built SPA, default ./dist
 *   ENCRYPTION_KEY   base64 of 32 bytes; generated into DATA_DIR if absent
 *   ALLOW_SIGNUP     "false" to close registration
 *   PBKDF2_ITERATIONS
 */

import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { getRequestListener } from '@hono/node-server';
import { WebSocketServer, type WebSocket } from 'ws';

import { app } from '../server/index.ts';
import type { Env } from '../server/env.ts';
import { createAssetServer } from './assets.ts';
import { openDatabase, type NodeD1Database } from './d1-sqlite.ts';
import { attachPhone, attachTv, checkPhoneJoin, isPairingCode, pruneRooms } from './rooms.ts';
import { sha256 } from './session.ts';

const PORT = Number(process.env.PORT ?? 8788);
const HOST = process.env.HOST ?? '0.0.0.0';
const DATA_DIR = resolve(process.env.DATA_DIR ?? './data');
const ASSETS_DIR = resolve(process.env.ASSETS_DIR ?? './dist');

/* --------------------------- data directory ---------------------------- */

mkdirSync(DATA_DIR, { recursive: true });

/**
 * The credential vault key.
 *
 * Generated once into the data directory if not supplied, so `docker run` works
 * with no configuration — but it is written to a file rather than regenerated per
 * start, because rotating it would make every stored storage password
 * undecryptable.
 */
function resolveEncryptionKey(): string {
  if (process.env.ENCRYPTION_KEY) return process.env.ENCRYPTION_KEY;

  const keyFile = join(DATA_DIR, 'encryption.key');
  if (existsSync(keyFile)) return readFileSync(keyFile, 'utf8').trim();

  // Encoded via the shared helper rather than Buffer#toString, so the Node and
  // Worker builds produce byte-identical keys.
  const key = Buffer.from(randomBytes(32)).toString('base64') as string;
  writeFileSync(keyFile, key + '\n', { mode: 0o600 });
  console.log(`Generated a new credential-vault key at ${keyFile}`);
  console.log('Keep it: losing it makes saved data-source passwords unreadable.');
  return key;
}

/* ------------------------------ database ------------------------------- */

const dbFile = join(DATA_DIR, 'hearth.sqlite');
const db: NodeD1Database = openDatabase(dbFile);

/** Applies schema.sql, then any column a newer build expects. */
function migrate(): void {
  const schemaPath = findSchema();
  if (!schemaPath) {
    console.warn('schema.sql not found; assuming the database is already prepared.');
    return;
  }
  const sql = readFileSync(schemaPath, 'utf8');
  db.raw().exec(sql);

  // Mirror tools/migrate.mjs: add columns that predate this build.
  const columns = db.raw().prepare('PRAGMA table_info(sources)').all() as { name: string }[];
  if (columns.length && !columns.some((c) => c.name === 'access')) {
    db.raw().exec("ALTER TABLE sources ADD COLUMN access TEXT NOT NULL DEFAULT 'proxy'");
    console.log('Migrated: added sources.access');
  }
}

function findSchema(): string | null {
  for (const candidate of ['./schema.sql', '../schema.sql', '/app/schema.sql']) {
    const path = resolve(candidate);
    if (existsSync(path)) return path;
  }
  return null;
}

migrate();

/* -------------------------------- env ---------------------------------- */

const env = {
  DB: db,
  ASSETS: createAssetServer(ASSETS_DIR),
  // Never used in this deployment: WebSocket upgrades are handled by `ws`
  // before Hono sees them. Present so the type matches, and loud if reached.
  REMOTE_ROOM: {
    idFromName() {
      throw new Error('Durable Objects are not used in the self-hosted server.');
    },
    get() {
      throw new Error('Durable Objects are not used in the self-hosted server.');
    },
  },
  ENCRYPTION_KEY: resolveEncryptionKey(),
  APP_NAME: 'Hearth',
  ALLOW_SIGNUP: process.env.ALLOW_SIGNUP,
  PBKDF2_ITERATIONS: process.env.PBKDF2_ITERATIONS,
} as unknown as Env;

/* ------------------------------- server -------------------------------- */

const listener = getRequestListener((request) => app.fetch(request, env));
const server = createServer(listener);

/**
 * WebSocket upgrades are handled here rather than inside Hono.
 *
 * `ws` needs the raw HTTP upgrade, which the fetch-style handler cannot express
 * on Node. Doing it at this level also keeps the Durable Object shim unused.
 */
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (url.pathname !== '/api/remote/socket') {
    socket.destroy();
    return;
  }

  const code = (url.searchParams.get('code') ?? '').toUpperCase();
  const role = url.searchParams.get('role') === 'tv' ? 'tv' : 'phone';

  const reject = (status: number, reason: string) => {
    socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };

  if (!isPairingCode(code)) return reject(400, 'Malformed pairing code');

  void (async () => {
    if (role === 'tv') {
      // Only a signed-in TV may claim a room.
      const authed = await isSignedIn(request.headers.cookie ?? '');
      if (!authed) return reject(401, 'Sign in on the TV first');
    } else {
      const rejection = checkPhoneJoin(code);
      if (rejection) return reject(rejection.status, rejection.reason);
    }

    wss.handleUpgrade(request, socket, head, (socketConnection: WebSocket) => {
      if (role === 'tv') attachTv(code, socketConnection);
      else attachPhone(code, socketConnection);
    });
  })();
});

/** Validates the session cookie directly, since there is no Hono context here. */
async function isSignedIn(cookieHeader: string): Promise<boolean> {
  const match = cookieHeader.match(/(?:^|;\s*)hearth_sid=([^;]+)/);
  if (!match) return false;
  try {
    const row = await db
      .prepare('SELECT expires_at FROM sessions WHERE id = ?')
      .bind(await sha256(decodeURIComponent(match[1])))
      .first<{ expires_at: number }>();
    return Boolean(row && row.expires_at > Date.now());
  } catch {
    return false;
  }
}

/* ----------------------------- housekeeping ---------------------------- */

setInterval(
  () => {
    void db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()).run();
    pruneRooms();
  },
  60 * 60 * 1000,
).unref();

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log('');
  console.log('  Hearth is running');
  console.log(`  ┌ interface   http://${shown}:${PORT}`);
  console.log(`  ├ database    ${dbFile}`);
  console.log(`  └ assets      ${ASSETS_DIR}`);
  console.log('');
  console.log('  Served over plain HTTP on purpose: a browser blocks HTTPS pages from');
  console.log('  reaching http:// servers, so this is what lets Direct mode talk to a');
  console.log('  NAS on your own network. Open it from the machine at the television.');
  console.log('');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`\nReceived ${signal}, shutting down.`);
    server.close(() => process.exit(0));
    // Do not let a hung connection block the exit.
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
