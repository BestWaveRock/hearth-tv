import type { SourceKind } from '../types.ts';

/**
 * Reachability rules for the two access modes.
 *
 * Everything here is pure so it can be unit tested, because the browser's
 * mixed-content and private-network rules are subtle and giving a user *wrong*
 * advice about why their NAS will not connect is worse than giving none.
 */

/**
 * Direct mode needs the browser to authenticate a `<video>` element, which can
 * only be done from the URL itself. That rules WebDAV out: it authenticates with
 * an `Authorization` header, and a media element cannot set headers. OpenList
 * returns a pre-signed URL and Subsonic accepts its token in the query string,
 * so both work.
 */
export const DIRECT_CAPABLE_KINDS: SourceKind[] = ['openlist', 'navidrome'];

export function supportsDirect(kind: SourceKind): boolean {
  return DIRECT_CAPABLE_KINDS.includes(kind);
}

export type Blocker =
  /** Cloudflare's network cannot route to a LAN address. */
  | { code: 'private-from-cloud'; host: string }
  /** An https page cannot fetch from http. Not fixable from our side. */
  | { code: 'mixed-content'; host: string; pageOrigin: string }
  /** WebDAV cannot authenticate a <video> element. */
  | { code: 'kind-unsupported'; kind: SourceKind }
  /** The address is not a URL we can use at all. */
  | { code: 'bad-url'; detail: string };

const PRIVATE_V4 =
  /^(10\.|127\.|0\.|169\.254\.|192\.168\.)|^172\.(1[6-9]|2\d|3[01])\./;

/** RFC1918, loopback, link-local, CGNAT and the usual local-only suffixes. */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.home.arpa')) return true;
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80:')) return true;
  if (PRIVATE_V4.test(h)) return true;
  // 100.64.0.0/10 — carrier NAT, and what Tailscale hands out.
  const cg = h.match(/^100\.(\d+)\./);
  if (cg && Number(cg[1]) >= 64 && Number(cg[1]) <= 127) return true;
  return false;
}

/**
 * Origins the browser treats as "potentially trustworthy" even over plain http,
 * and therefore exempts from mixed-content blocking. Loopback only — a
 * `192.168.x.x` address is *not* exempt, which is the single most common reason
 * direct mode fails.
 */
export function isTrustworthyHttp(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '::1';
}

/**
 * Why direct mode cannot work for this source, or `null` if it can.
 *
 * `pageOrigin` is passed in rather than read from `location` so this stays pure.
 */
export function directModeBlocker(
  pageOrigin: string,
  baseUrl: string,
  kind: SourceKind,
): Blocker | null {
  if (!supportsDirect(kind)) return { code: 'kind-unsupported', kind };

  let target: URL;
  let page: URL;
  try {
    target = new URL(baseUrl);
    page = new URL(pageOrigin);
  } catch {
    return { code: 'bad-url', detail: baseUrl };
  }

  // An https page may not issue http subresource requests. The exception is
  // loopback, which browsers consider trustworthy.
  if (page.protocol === 'https:' && target.protocol === 'http:' && !isTrustworthyHttp(target.hostname)) {
    return { code: 'mixed-content', host: target.hostname, pageOrigin: page.origin };
  }

  return null;
}

/** Why proxy mode cannot work, or `null` if it can. */
export function proxyModeBlocker(pageOrigin: string, baseUrl: string): Blocker | null {
  let target: URL;
  try {
    target = new URL(baseUrl);
  } catch {
    return { code: 'bad-url', detail: baseUrl };
  }

  // During local development the Worker runs on this machine and *can* reach
  // the LAN, so the restriction genuinely does not apply.
  let page: URL;
  try {
    page = new URL(pageOrigin);
  } catch {
    return null;
  }
  if (isTrustworthyHttp(page.hostname)) return null;

  if (isPrivateHost(target.hostname)) {
    return { code: 'private-from-cloud', host: target.hostname };
  }
  return null;
}

/**
 * Which mode should be offered first for a given address.
 *
 * A private address can only ever work in direct mode; a public one is usually
 * better proxied, because that needs no CORS configuration on the server.
 */
export function suggestAccessMode(baseUrl: string, kind: SourceKind): 'proxy' | 'direct' {
  if (!supportsDirect(kind)) return 'proxy';
  try {
    const target = new URL(baseUrl);
    if (isPrivateHost(target.hostname)) return 'direct';
  } catch {
    /* fall through */
  }
  return 'proxy';
}
