/**
 * Cryptographic helpers that run identically in the Workers runtime and in a
 * browser.
 *
 * This file exists because the source adapters are shared: the same WebDAV and
 * Subsonic code runs server-side (proxy mode) and client-side (direct LAN mode).
 * Everything here is built on WebCrypto, `btoa`/`atob` and plain arithmetic, all
 * of which are present in both environments.
 *
 * Password hashing and the AES-GCM credential vault deliberately stay in
 * `server/crypto.ts`: those must never run in a browser.
 */

const te = new TextEncoder();

export function b64(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function unb64(input: string): Uint8Array<ArrayBuffer> {
  const s = atob(input);
  // Backed by a plain ArrayBuffer, not ArrayBufferLike: WebCrypto's BufferSource
  // rejects the SharedArrayBuffer-capable form.
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(new ArrayBuffer(n));
  crypto.getRandomValues(b);
  return b;
}

/**
 * Basic-auth header value.
 *
 * `btoa` only accepts Latin-1, so a non-ASCII username or password would throw.
 * UTF-8 encoding first is what makes a Chinese password work.
 */
export function basicAuth(username: string, password: string): string {
  return `Basic ${b64(te.encode(`${username}:${password}`))}`;
}

/** Subsonic's salted token scheme: token = md5(password + salt). */
export function subsonicToken(password: string, salt: string): string {
  return md5(password + salt);
}

/* --- Minimal MD5, required only by the Subsonic auth scheme. -----------
 * Neither WebCrypto nor the browser offers MD5, and Subsonic mandates it. */

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
