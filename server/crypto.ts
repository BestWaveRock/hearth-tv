/// <reference types="@cloudflare/workers-types" />

/**
 * Server-only cryptography: password hashing and the credential vault.
 *
 * The byte-level primitives and the adapters' auth helpers live in
 * `shared/sources/crypto.ts`, because the source adapters run in the browser too
 * (direct LAN mode). They are re-exported here so server code has one import.
 */

import { b64, randomBytes, unb64 } from '../shared/sources/crypto';

export { b64, unb64, randomBytes, basicAuth, subsonicToken } from '../shared/sources/crypto';

const te = new TextEncoder();
const td = new TextDecoder();

export function b64url(input: ArrayBuffer | Uint8Array): string {
  return b64(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** URL-safe opaque identifier. 16 bytes = 128 bits, plenty for row ids. */
export function newId(bytes = 16): string {
  return b64url(randomBytes(bytes));
}

export async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', te.encode(input));
  return b64(digest);
}

/**
 * Constant-time comparison. Short-circuiting on the first differing byte
 * would leak how much of a token an attacker guessed correctly.
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ------------------------------------------------------------------ *
 * Passwords — PBKDF2-SHA256.
 * WebCrypto has no argon2/scrypt, and PBKDF2 is the strongest KDF the
 * Workers runtime exposes. The iteration count is stored per user so it
 * can be raised later without invalidating existing logins.
 * ------------------------------------------------------------------ */

export const DEFAULT_PBKDF2_ITERATIONS = 100_000;

export async function derivePassword(
  password: string,
  saltB64: string,
  iterations: number,
): Promise<string> {
  const key = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations },
    key,
    256,
  );
  return b64(bits);
}

export async function hashNewPassword(
  password: string,
  iterations = DEFAULT_PBKDF2_ITERATIONS,
): Promise<{ hash: string; salt: string; iterations: number }> {
  const salt = b64(randomBytes(16));
  const hash = await derivePassword(password, salt, iterations);
  return { hash, salt, iterations };
}

/* ------------------------------------------------------------------ *
 * The credential vault — AES-256-GCM.
 * WebDAV / Navidrome / OpenList passwords must be replayable (we send them
 * upstream on every request), so they cannot be one-way hashed. They are
 * instead sealed with a key that lives only in the Worker's secret store.
 * ------------------------------------------------------------------ */

export async function vaultKey(secretB64: string): Promise<CryptoKey> {
  let raw: Uint8Array;
  try {
    raw = unb64(secretB64);
  } catch {
    throw new Error('ENCRYPTION_KEY is not valid base64');
  }
  if (raw.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode to exactly 32 bytes (got ${raw.length}). Generate one with: npm run secret:key`,
    );
  }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Returns `v1.<iv-b64>.<ciphertext-b64>`; the IV is fresh per seal. */
export async function seal(key: CryptoKey, value: unknown): Promise<string> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    te.encode(JSON.stringify(value)),
  );
  return `v1.${b64(iv)}.${b64(ct)}`;
}

export async function unseal<T>(key: CryptoKey, blob: string): Promise<T> {
  const parts = blob.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') throw new Error('malformed sealed blob');
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(parts[1]) },
    key,
    unb64(parts[2]),
  );
  return JSON.parse(td.decode(pt)) as T;
}
