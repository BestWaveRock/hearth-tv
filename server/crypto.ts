/// <reference types="@cloudflare/workers-types" />

/**
 * Cryptographic primitives, built only on WebCrypto so the exact same code
 * runs on the Workers runtime with no native dependencies.
 */

const te = new TextEncoder();
const td = new TextDecoder();

export function b64(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function unb64(input: string): Uint8Array {
  const s = atob(input);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function b64url(input: ArrayBuffer | Uint8Array): string {
  return b64(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
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

/** Basic-auth header value for upstream WebDAV / Subsonic servers. */
export function basicAuth(username: string, password: string): string {
  return `Basic ${b64(te.encode(`${username}:${password}`))}`;
}

/** Subsonic's salted token scheme: token = md5(password + salt). */
export async function subsonicToken(password: string, salt: string): Promise<string> {
  // Workers' WebCrypto does not implement MD5, so it is done by hand.
  return md5(password + salt);
}

/* --- Minimal MD5, required only by the Subsonic auth scheme. --------- */

function md5(input: string): string {
  const bytes = te.encode(input);
  const len = bytes.length;
  const withPad = new Uint8Array((((len + 8) >> 6) + 1) << 6);
  withPad.set(bytes);
  withPad[len] = 0x80;
  const bitLen = len * 8;
  const dv = new DataView(withPad.buffer);
  dv.setUint32(withPad.length - 8, bitLen >>> 0, true);
  dv.setUint32(withPad.length - 4, Math.floor(bitLen / 4294967296), true);

  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const K: number[] = [];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;

  for (let chunk = 0; chunk < withPad.length; chunk += 64) {
    const M: number[] = [];
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(chunk + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }

  return [a0, b0, c0, d0].map(hexLE).join('');
}

function hexLE(n: number): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
  return s;
}
