/// <reference types="@cloudflare/workers-types" />

import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from './env';
import type { User } from '../shared/types';
import {
  DEFAULT_PBKDF2_ITERATIONS,
  b64url,
  derivePassword,
  hashNewPassword,
  newId,
  randomBytes,
  safeEqual,
  sha256,
  vaultKey,
} from './crypto';

export const SESSION_COOKIE = 'hearth_sid';
const SESSION_TTL_MS = 45 * 24 * 60 * 60 * 1000; // 45 days — a TV should stay logged in.

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  pass_hash: string;
  pass_salt: string;
  pass_iter: number;
  avatar_hue: number;
  created_at: number;
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarHue: row.avatar_hue,
    createdAt: row.created_at,
  };
}

export function normaliseUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Rejects the credentials that make a self-hosted box trivially ownable. */
export function validateCredentials(username: string, password: string): void {
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    throw new HTTPException(400, {
      message: 'Username must be 3–32 characters: letters, numbers, dot, dash or underscore.',
    });
  }
  if (password.length < 8) {
    throw new HTTPException(400, { message: 'Password must be at least 8 characters.' });
  }
  if (password.length > 256) {
    throw new HTTPException(400, { message: 'Password must be at most 256 characters.' });
  }
}

export async function createUser(
  c: Context<AppEnv>,
  usernameRaw: string,
  password: string,
  displayName?: string,
): Promise<User> {
  const username = normaliseUsername(usernameRaw);
  validateCredentials(username, password);

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?')
    .bind(username)
    .first<{ id: string }>();
  if (existing) throw new HTTPException(409, { message: 'That username is already taken.' });

  const iterations = Number(c.env.PBKDF2_ITERATIONS) || DEFAULT_PBKDF2_ITERATIONS;
  const { hash, salt } = await hashNewPassword(password, iterations);

  const user: UserRow = {
    id: newId(),
    username,
    display_name: (displayName?.trim() || usernameRaw.trim()).slice(0, 48),
    pass_hash: hash,
    pass_salt: salt,
    pass_iter: iterations,
    // A warm hue per account, used for the tvOS-style profile bubble.
    avatar_hue: 12 + Math.floor(Math.random() * 48),
    created_at: Date.now(),
  };

  await c.env.DB.prepare(
    `INSERT INTO users (id, username, display_name, pass_hash, pass_salt, pass_iter, avatar_hue, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      user.id,
      user.username,
      user.display_name,
      user.pass_hash,
      user.pass_salt,
      user.pass_iter,
      user.avatar_hue,
      user.created_at,
    )
    .run();

  return toUser(user);
}

export async function verifyLogin(
  c: Context<AppEnv>,
  usernameRaw: string,
  password: string,
): Promise<User> {
  const username = normaliseUsername(usernameRaw);
  const row = await c.env.DB.prepare('SELECT * FROM users WHERE username = ?')
    .bind(username)
    .first<UserRow>();

  // Always run a derivation, even for a missing user, so response time does
  // not reveal whether the username exists.
  const salt = row?.pass_salt ?? 'AAAAAAAAAAAAAAAAAAAAAA==';
  const iter = row?.pass_iter ?? DEFAULT_PBKDF2_ITERATIONS;
  const candidate = await derivePassword(password, salt, iter);

  if (!row || !safeEqual(candidate, row.pass_hash)) {
    throw new HTTPException(401, { message: 'Incorrect username or password.' });
  }
  return toUser(row);
}

export async function issueSession(c: Context<AppEnv>, userId: string): Promise<void> {
  const token = b64url(randomBytes(32));
  const now = Date.now();

  // Only the hash is stored: a database leak cannot be replayed as a login.
  await c.env.DB.prepare(
    'INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(
      await sha256(token),
      userId,
      now,
      now + SESSION_TTL_MS,
      (c.req.header('user-agent') ?? '').slice(0, 200),
    )
    .run();

  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: new URL(c.req.url).protocol === 'https:',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export async function revokeSession(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256(token)).run();
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

async function resolveSession(c: Context<AppEnv>): Promise<{ user: User; sessionId: string } | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;

  const id = await sha256(token);
  const row = await c.env.DB.prepare(
    `SELECT s.id AS sid, s.expires_at, u.*
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
  )
    .bind(id)
    .first<UserRow & { sid: string; expires_at: number }>();

  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
    return null;
  }
  return { user: toUser(row), sessionId: row.sid };
}

/** Populates `user` when a valid cookie is present, but never rejects. */
export const optionalAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await resolveSession(c);
  if (session) {
    c.set('user', session.user);
    c.set('sessionId', session.sessionId);
  }
  await next();
};

/** Guards every route that touches user data. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await resolveSession(c);
  if (!session) throw new HTTPException(401, { message: 'Not signed in.' });
  c.set('user', session.user);
  c.set('sessionId', session.sessionId);
  await next();
};

/** Imports the vault key on demand and memoises it on the request context. */
export async function getVault(c: Context<AppEnv>): Promise<CryptoKey> {
  const cached = c.get('vault');
  if (cached) return cached;
  if (!c.env.ENCRYPTION_KEY) {
    throw new HTTPException(500, {
      message: 'Server is missing ENCRYPTION_KEY. Run: npx wrangler secret put ENCRYPTION_KEY',
    });
  }
  const key = await vaultKey(c.env.ENCRYPTION_KEY);
  c.set('vault', key);
  return key;
}

/** Opportunistic cleanup so the sessions table cannot grow without bound. */
export async function pruneExpiredSessions(env: AppEnv['Bindings']): Promise<void> {
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()).run();
}
