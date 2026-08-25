import type { Entry, Listing, SourceCredentials, SourceSummary } from '../../shared/types';
import { openlistAdapter } from '../../shared/sources/openlist';
import { subsonicAdapter } from '../../shared/sources/subsonic';
import { webdavAdapter } from '../../shared/sources/webdav';
import { directModeBlocker, supportsDirect } from '../../shared/sources/reachability';
import {
  type Adapter,
  type SourceContext,
  crumbsFor,
  normalisePath,
  parentPath,
} from '../../shared/sources/util';
import { api } from './api';

/**
 * Direct transport: the browser talks to the storage server itself.
 *
 * This is the point of the whole feature — a NAS on the local network is
 * unreachable from Cloudflare's edge, but perfectly reachable from the computer
 * in front of the television. Bytes go straight from the NAS to the video
 * element at full LAN speed and never leave the house.
 *
 * The adapters are the *same modules* the Worker uses, imported from `shared/`.
 * That is deliberate: two implementations of the Subsonic auth dance would
 * inevitably drift, and then "works in proxy mode but not direct" becomes a
 * whole class of bug that cannot happen if there is only one implementation.
 *
 * What differs is only who calls `fetch` — and the constraints that follow from
 * the browser being the caller: CORS, and the mixed-content rule.
 */

const ADAPTERS: Record<string, Adapter> = {
  webdav: webdavAdapter,
  navidrome: subsonicAdapter,
  openlist: openlistAdapter,
};

/** Credentials are fetched once per source and kept for the tab's lifetime. */
const credentialCache = new Map<string, SourceCredentials>();

export function forgetCredentials(sourceId?: string): void {
  if (sourceId) credentialCache.delete(sourceId);
  else credentialCache.clear();
}

async function credentialsFor(sourceId: string): Promise<SourceCredentials> {
  const cached = credentialCache.get(sourceId);
  if (cached) return cached;
  const res = await api.sourceCredentials(sourceId);
  credentialCache.set(sourceId, res.credentials);
  return res.credentials;
}

async function contextFor(source: SourceSummary): Promise<SourceContext> {
  return {
    id: source.id,
    kind: source.kind,
    name: source.name,
    baseUrl: source.baseUrl,
    rootPath: source.rootPath,
    media: source.media,
    creds: await credentialsFor(source.id),
  };
}

/**
 * Turns the browser's opaque network failures into an explanation.
 *
 * A blocked cross-origin request and an unreachable host are *both* reported to
 * JavaScript as an indistinguishable `TypeError: Failed to fetch` — the browser
 * withholds the detail on purpose, to avoid leaking whether a host exists. So
 * the cause has to be reasoned about rather than read, which is exactly what
 * this does.
 */
export function explainDirectFailure(source: SourceSummary, error: unknown): string {
  const blocker = directModeBlocker(location.origin, source.baseUrl, source.kind);

  if (blocker?.code === 'mixed-content') {
    return (
      `This page is served over HTTPS, and browsers refuse to load anything over plain HTTP from an ` +
      `HTTPS page. “${blocker.host}” is plain HTTP, so the request was blocked before it was even sent. ` +
      `Give the server HTTPS, or open Hearth from a local copy over HTTP.`
    );
  }
  if (blocker?.code === 'kind-unsupported') {
    return 'WebDAV cannot be used in Direct mode. Switch this source to Proxy access.';
  }

  const message = error instanceof Error ? error.message : String(error);

  // The signature of a CORS rejection or a host that is simply not there.
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return (
      `The browser could not reach ${source.baseUrl}. The two likely causes: the server is not sending ` +
      `CORS headers that allow ${location.origin}, or this computer is not on the same network as the ` +
      `server. A blocked request and an unreachable host look identical to a web page, so both have to ` +
      `be checked. Open the address directly in a new tab to rule out the second.`
    );
  }
  return message;
}

export function canUseDirect(source: SourceSummary): boolean {
  return source.access === 'direct' && supportsDirect(source.kind);
}

/**
 * Rewrites `/api/art?src=…&ref=…` into a URL on the storage server.
 *
 * The Subsonic adapter emits an API path because that is correct for proxy mode.
 * In direct mode the Worker cannot reach the server at all, so every reference
 * has to be re-pointed. Done here, at the listing boundary, so no screen has to
 * know that artwork URLs are transport-dependent.
 */
async function rewriteArt(ctx: SourceContext, adapter: Adapter, entries: Entry[]): Promise<Entry[]> {
  if (!adapter.art) return entries;

  return Promise.all(
    entries.map(async (entry) => {
      if (!entry.art) return entry;
      // OpenList thumbnails are already absolute and pre-signed.
      if (!entry.art.startsWith('/api/art')) return entry;

      const match = entry.art.match(/[?&]ref=([^&]+)/);
      if (!match) return { ...entry, art: null };
      try {
        const target = await adapter.art!(ctx, decodeURIComponent(match[1]), 512);
        return { ...entry, art: target?.url ?? null };
      } catch {
        return { ...entry, art: null };
      }
    }),
  );
}

/* ----------------------------- operations ------------------------------ */

export async function directBrowse(source: SourceSummary, path: string): Promise<Listing> {
  const adapter = ADAPTERS[source.kind];
  if (!adapter) throw new Error(`Unsupported source type: ${source.kind}`);

  const ctx = await contextFor(source);
  const clean = normalisePath(path);
  const entries = await adapter.list(ctx, clean);

  return {
    sourceId: source.id,
    path: clean,
    parent: parentPath(clean),
    entries: await rewriteArt(ctx, adapter, entries),
    crumbs: crumbsFor(source.name, clean),
  };
}

export async function directSearch(source: SourceSummary, query: string): Promise<Entry[]> {
  const adapter = ADAPTERS[source.kind];
  if (!adapter?.search) return [];
  const ctx = await contextFor(source);
  return rewriteArt(ctx, adapter, await adapter.search(ctx, query));
}

export async function directShelves(source: SourceSummary) {
  const adapter = ADAPTERS[source.kind];
  if (!adapter?.shelves) return [];
  const ctx = await contextFor(source);
  const shelves = await adapter.shelves(ctx);
  return Promise.all(
    shelves.map(async (shelf) => ({
      ...shelf,
      entries: await rewriteArt(ctx, adapter, shelf.entries),
    })),
  );
}

/**
 * A URL a `<video>` or `<audio>` element can load on its own.
 *
 * Media elements cannot set request headers, so the credentials have to be in
 * the URL. OpenList returns a pre-signed link on the provider's CDN, and
 * Subsonic accepts its salted token as query parameters. This is precisely why
 * `DIRECT_CAPABLE_KINDS` excludes WebDAV.
 */
export async function directStreamUrl(source: SourceSummary, path: string): Promise<string> {
  const adapter = ADAPTERS[source.kind];
  if (!adapter) throw new Error(`Unsupported source type: ${source.kind}`);
  const target = await adapter.stream(await contextFor(source), normalisePath(path));
  if (Object.keys(target.headers).length > 0) {
    throw new Error(
      `${source.kind} needs an Authorization header to stream, which a media element cannot send. Use Proxy access for this source.`,
    );
  }
  return target.url;
}

/** Artwork URL for direct mode; falls back to null when unsupported. */
export async function directArtUrl(
  source: SourceSummary,
  ref: string,
  size = 512,
): Promise<string | null> {
  const adapter = ADAPTERS[source.kind];
  if (!adapter?.art) return null;
  const target = await adapter.art(await contextFor(source), ref, size);
  return target?.url ?? null;
}

/**
 * Connection test that runs in the browser, so it tests the path the media will
 * actually take rather than the server's view of the world.
 */
export async function directTest(
  source: SourceSummary,
): Promise<{ ok: boolean; message: string }> {
  const blocker = directModeBlocker(location.origin, source.baseUrl, source.kind);
  if (blocker) {
    return { ok: false, message: explainDirectFailure(source, new Error('blocked')) };
  }
  const adapter = ADAPTERS[source.kind];
  if (!adapter) return { ok: false, message: `Unsupported source type: ${source.kind}` };

  try {
    const message = await adapter.test(await contextFor(source));
    return { ok: true, message };
  } catch (err) {
    return { ok: false, message: explainDirectFailure(source, err) };
  }
}
