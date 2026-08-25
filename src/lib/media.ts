import type { Entry, Listing, SourceSummary } from '../../shared/types';
import { api, streamUrl } from './api';
import {
  canUseDirect,
  directArtUrl,
  directBrowse,
  directSearch,
  directShelves,
  directStreamUrl,
  directTest,
  explainDirectFailure,
} from './direct';
import { useApp } from '../store/app';

/**
 * One access layer over both transports.
 *
 * Screens ask for a listing or a stream URL and get one; whether the bytes came
 * via the Worker or straight off a NAS on the local network is decided here, from
 * the source's `access` mode. Keeping that decision in a single module is what
 * stops "does this screen support direct mode?" from becoming a question anyone
 * has to ask.
 */

export function sourceById(sourceId: string): SourceSummary | undefined {
  return useApp.getState().sources.find((s) => s.id === sourceId);
}

/** Resolves a listing through whichever transport the source is configured for. */
export async function browseSource(sourceId: string, path: string): Promise<Listing> {
  const source = sourceById(sourceId);

  if (source && canUseDirect(source)) {
    try {
      return await directBrowse(source, path);
    } catch (err) {
      throw new Error(explainDirectFailure(source, err));
    }
  }
  return api.browse(sourceId, path);
}

/**
 * A URL the media element can load.
 *
 * Proxy mode returns a same-origin API path, authenticated by the session
 * cookie. Direct mode returns the storage server's own URL, with credentials
 * embedded in the query string because a media element cannot send headers.
 */
export async function resolveStreamUrl(sourceId: string, path: string): Promise<string> {
  const source = sourceById(sourceId);
  if (source && canUseDirect(source)) {
    try {
      return await directStreamUrl(source, path);
    } catch (err) {
      throw new Error(explainDirectFailure(source, err));
    }
  }
  return streamUrl(sourceId, path);
}

/**
 * Rewrites artwork URLs for direct mode.
 *
 * The Subsonic adapter emits `/api/art?src=…&ref=…` because that is right for
 * proxy mode. In direct mode the Worker cannot reach the server at all, so the
 * reference is resolved against the storage server instead.
 */
export async function resolveArt(sourceId: string, entry: Entry): Promise<string | null> {
  if (!entry.art) return null;
  const source = sourceById(sourceId);
  if (!source || !canUseDirect(source)) return entry.art;

  const match = entry.art.match(/[?&]ref=([^&]+)/);
  if (!match) return entry.art;
  try {
    return await directArtUrl(source, decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

/** Search one source through its own transport. */
export async function searchSource(source: SourceSummary, query: string): Promise<Entry[]> {
  if (canUseDirect(source)) {
    try {
      return await directSearch(source, query);
    } catch {
      // A single unreachable source must not fail the whole search.
      return [];
    }
  }
  return [];
}

/** Home-screen shelves for a direct source, built in the browser. */
export async function shelvesForDirectSource(source: SourceSummary) {
  try {
    const shelves = await directShelves(source);
    if (shelves.length) {
      return shelves.map((shelf) => ({
        id: shelf.id,
        title: `${shelf.title} · ${source.name}`,
        sourceId: source.id,
        path: shelf.path,
        entries: shelf.entries,
      }));
    }
    const listing = await directBrowse(source, '/');
    return [
      {
        id: `${source.id}:root`,
        title: source.name,
        sourceId: source.id,
        path: '/',
        entries: listing.entries.slice(0, 24),
      },
    ];
  } catch {
    // Reported separately by the Home screen's problem list.
    return [];
  }
}

/** Connection test, run over the transport the source will actually use. */
export async function testSourceConnection(
  source: SourceSummary,
): Promise<{ ok: boolean; message: string }> {
  if (canUseDirect(source)) return directTest(source);
  return api.testSource(source.id);
}

export { canUseDirect, explainDirectFailure };
