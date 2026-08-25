import type { Entry } from '../types.ts';
import { b64, randomBytes, subsonicToken } from './crypto.ts';
import {
  type Adapter,
  type Shelf,
  type SourceContext,
  type StreamTarget,
  fetchWithTimeout,
  normalisePath,
} from './util.ts';

/**
 * Navidrome speaks the Subsonic API, so this adapter also works with Gonic,
 * Airsonic, Ampache and Subsonic itself.
 *
 * A music server is not a filesystem, so browsing is modelled as a set of
 * virtual paths:
 *
 *   /                    the library's top-level menu
 *   /list/<type>         getAlbumList2 (newest | frequent | recent | random | starred)
 *   /albums              every album, alphabetical
 *   /artists             artist index
 *   /artist/<id>         one artist's albums
 *   /album/<id>          one album's tracks
 *   /playlists           playlists
 *   /playlist/<id>       one playlist's tracks
 *   /track/<id>          a playable song (never listed, only streamed)
 */

interface SubsonicEnvelope<T> {
  'subsonic-response': T & {
    status: 'ok' | 'failed';
    version: string;
    error?: { code: number; message: string };
  };
}

interface SubsonicAlbum {
  id: string;
  name: string;
  artist?: string;
  artistId?: string;
  coverArt?: string;
  songCount?: number;
  duration?: number;
  year?: number;
  created?: string;
}

interface SubsonicSong {
  id: string;
  title: string;
  album?: string;
  artist?: string;
  coverArt?: string;
  duration?: number;
  track?: number;
  year?: number;
  suffix?: string;
  size?: number;
  isVideo?: boolean;
}

interface SubsonicArtist {
  id: string;
  name: string;
  albumCount?: number;
  coverArt?: string;
  artistImageUrl?: string;
}

interface SubsonicPlaylist {
  id: string;
  name: string;
  songCount?: number;
  duration?: number;
  coverArt?: string;
  comment?: string;
}

const CLIENT = 'HearthTV';
const API_VERSION = '1.16.1';

/**
 * Remembers, per source, that a server rejected token auth so we stop paying
 * for a failed round trip on every single request.
 */
const plaintextAuthRequired = new Set<string>();

async function authParams(ctx: SourceContext): Promise<URLSearchParams> {
  const p = new URLSearchParams({ v: API_VERSION, c: CLIENT, f: 'json' });
  const user = ctx.creds.username ?? '';
  const pass = ctx.creds.password ?? '';
  p.set('u', user);

  if (plaintextAuthRequired.has(ctx.id)) {
    // Hex-encoded plaintext, the legacy Subsonic scheme.
    p.set('p', pass);
  } else {
    const salt = b64(randomBytes(9)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'hearthsalt';
    p.set('s', salt);
    p.set('t', await subsonicToken(pass, salt));
  }
  return p;
}

function apiUrl(ctx: SourceContext, endpoint: string, params: URLSearchParams): string {
  const base = ctx.baseUrl.replace(/\/+$/, '');
  const root = normalisePath(ctx.rootPath);
  const prefix = root === '/' ? '' : root;
  return `${base}${prefix}/rest/${endpoint}?${params.toString()}`;
}

async function call<T>(
  ctx: SourceContext,
  endpoint: string,
  extra: Record<string, string | number | undefined> = {},
  retrying = false,
): Promise<T> {
  const params = await authParams(ctx);
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined && v !== null) params.set(k, String(v));
  }

  const res = await fetchWithTimeout(apiUrl(ctx, endpoint, params), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(
        'No Subsonic API found at that address. For Navidrome use the base URL, e.g. https://music.example.com',
      );
    }
    throw new Error(`Music server responded ${res.status} ${res.statusText}`);
  }

  const text = await res.text();
  let body: SubsonicEnvelope<Record<string, unknown>>;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error('Music server returned a non-JSON response; is this really a Subsonic server?');
  }

  const envelope = body['subsonic-response'];
  if (!envelope) throw new Error('Unexpected response shape from the music server.');

  if (envelope.status === 'failed') {
    const code = envelope.error?.code ?? 0;
    // 41 = "token authentication not supported by this server"
    if (code === 41 && !retrying) {
      plaintextAuthRequired.add(ctx.id);
      return call<T>(ctx, endpoint, extra, true);
    }
    if (code === 40) throw new Error('Music server rejected the username or password.');
    if (code === 50) throw new Error('This account is not allowed to browse the music library.');
    throw new Error(envelope.error?.message ?? `Music server error ${code}`);
  }

  return envelope as unknown as T;
}

function artUrl(ctx: SourceContext, coverArt?: string, size = 512): string | null {
  if (!coverArt) return null;
  return `/api/art?src=${encodeURIComponent(ctx.id)}&ref=${encodeURIComponent(coverArt)}&size=${size}`;
}

function albumEntry(ctx: SourceContext, a: SubsonicAlbum): Entry {
  return {
    id: `/album/${a.id}`,
    path: `/album/${a.id}`,
    name: a.name,
    title: a.name,
    kind: 'album',
    art: artUrl(ctx, a.coverArt ?? a.id),
    subtitle: a.artist ?? null,
    artist: a.artist ?? null,
    album: a.name,
    year: a.year ?? null,
    duration: a.duration,
  };
}

function songEntry(ctx: SourceContext, s: SubsonicSong): Entry {
  return {
    id: `/track/${s.id}`,
    path: `/track/${s.id}`,
    name: s.title,
    title: s.title,
    kind: 'track',
    art: artUrl(ctx, s.coverArt ?? s.id, 512),
    subtitle: s.artist ?? s.album ?? null,
    artist: s.artist ?? null,
    album: s.album ?? null,
    duration: s.duration,
    trackNumber: s.track ?? null,
    year: s.year ?? null,
    size: s.size,
    ext: s.suffix ?? null,
  };
}

function artistEntry(ctx: SourceContext, a: SubsonicArtist): Entry {
  return {
    id: `/artist/${a.id}`,
    path: `/artist/${a.id}`,
    name: a.name,
    title: a.name,
    kind: 'artist',
    art: artUrl(ctx, a.coverArt ?? `ar-${a.id}`),
    subtitle: a.albumCount ? `${a.albumCount} album${a.albumCount === 1 ? '' : 's'}` : null,
  };
}

function playlistEntry(ctx: SourceContext, p: SubsonicPlaylist): Entry {
  return {
    id: `/playlist/${p.id}`,
    path: `/playlist/${p.id}`,
    name: p.name,
    title: p.name,
    kind: 'playlist',
    art: artUrl(ctx, p.coverArt ?? `pl-${p.id}`),
    subtitle: p.songCount ? `${p.songCount} track${p.songCount === 1 ? '' : 's'}` : null,
  };
}

function menuEntry(id: string, title: string, subtitle: string): Entry {
  return {
    id,
    path: id,
    name: title,
    title,
    kind: 'folder',
    art: null,
    subtitle,
  };
}

const LIST_TITLES: Record<string, string> = {
  newest: 'Recently Added',
  frequent: 'Most Played',
  recent: 'Recently Played',
  random: 'Surprise Me',
  starred: 'Favourites',
  alphabeticalByName: 'All Albums',
  alphabeticalByArtist: 'By Artist',
};

export const subsonicAdapter: Adapter = {
  kind: 'navidrome',

  async list(ctx, rawPath) {
    const path = normalisePath(rawPath);
    const segs = path.split('/').filter(Boolean);

    if (segs.length === 0) {
      return [
        menuEntry('/list/newest', 'Recently Added', 'Fresh in your library'),
        menuEntry('/list/frequent', 'Most Played', 'The ones you keep coming back to'),
        menuEntry('/list/recent', 'Recently Played', 'Pick up where you left off'),
        menuEntry('/list/starred', 'Favourites', 'Everything you starred'),
        menuEntry('/albums', 'All Albums', 'Alphabetical'),
        menuEntry('/artists', 'Artists', 'Browse by performer'),
        menuEntry('/playlists', 'Playlists', 'Your curated sets'),
        menuEntry('/list/random', 'Surprise Me', 'A random shelf, every time'),
      ];
    }

    const [head, id] = segs;

    if (head === 'albums') {
      const r = await call<{ albumList2?: { album?: SubsonicAlbum[] } }>(ctx, 'getAlbumList2', {
        type: 'alphabeticalByName',
        size: 500,
      });
      return (r.albumList2?.album ?? []).map((a) => albumEntry(ctx, a));
    }

    if (head === 'list') {
      const type = id ?? 'newest';
      const r = await call<{ albumList2?: { album?: SubsonicAlbum[] } }>(ctx, 'getAlbumList2', {
        type,
        size: 100,
      });
      return (r.albumList2?.album ?? []).map((a) => albumEntry(ctx, a));
    }

    if (head === 'artists') {
      const r = await call<{ artists?: { index?: { artist?: SubsonicArtist[] }[] } }>(
        ctx,
        'getArtists',
      );
      const out: Entry[] = [];
      for (const idx of r.artists?.index ?? []) {
        for (const a of idx.artist ?? []) out.push(artistEntry(ctx, a));
      }
      return out;
    }

    if (head === 'artist' && id) {
      const r = await call<{ artist?: { album?: SubsonicAlbum[] } }>(ctx, 'getArtist', { id });
      return (r.artist?.album ?? []).map((a) => albumEntry(ctx, a));
    }

    if (head === 'album' && id) {
      const r = await call<{ album?: { song?: SubsonicSong[] } }>(ctx, 'getAlbum', { id });
      return (r.album?.song ?? [])
        .map((s) => songEntry(ctx, s))
        .sort((a, b) => (a.trackNumber ?? 0) - (b.trackNumber ?? 0));
    }

    if (head === 'playlists') {
      const r = await call<{ playlists?: { playlist?: SubsonicPlaylist[] } }>(ctx, 'getPlaylists');
      return (r.playlists?.playlist ?? []).map((p) => playlistEntry(ctx, p));
    }

    if (head === 'playlist' && id) {
      const r = await call<{ playlist?: { entry?: SubsonicSong[] } }>(ctx, 'getPlaylist', { id });
      return (r.playlist?.entry ?? []).map((s) => songEntry(ctx, s));
    }

    throw new Error(`Unknown music library path: ${path}`);
  },

  async shelves(ctx): Promise<Shelf[]> {
    // Three requests in parallel; one slow shelf must not block the others.
    const types = ['newest', 'frequent', 'random'];
    const results = await Promise.allSettled(
      types.map((type) =>
        call<{ albumList2?: { album?: SubsonicAlbum[] } }>(ctx, 'getAlbumList2', {
          type,
          size: 18,
        }),
      ),
    );

    const shelves: Shelf[] = [];
    results.forEach((r, i) => {
      if (r.status !== 'fulfilled') return;
      const albums = r.value.albumList2?.album ?? [];
      if (!albums.length) return;
      shelves.push({
        id: `${ctx.id}:${types[i]}`,
        title: LIST_TITLES[types[i]] ?? types[i],
        path: `/list/${types[i]}`,
        entries: albums.map((a) => albumEntry(ctx, a)),
      });
    });
    return shelves;
  },

  async stream(ctx, rawPath): Promise<StreamTarget> {
    const segs = normalisePath(rawPath).split('/').filter(Boolean);
    if (segs[0] !== 'track' || !segs[1]) {
      throw new Error(`Not a playable music path: ${rawPath}`);
    }
    const params = await authParams(ctx);
    params.set('id', segs[1]);
    // Ask for the original file; the browser handles mp3/flac/aac/opus fine.
    params.set('format', 'raw');
    return { url: apiUrl(ctx, 'stream', params), headers: {} };
  },

  async art(ctx, ref, size = 512): Promise<StreamTarget> {
    const params = await authParams(ctx);
    params.set('id', ref);
    params.set('size', String(size));
    return { url: apiUrl(ctx, 'getCoverArt', params), headers: {} };
  },

  async test(ctx) {
    await call<Record<string, never>>(ctx, 'ping');
    const r = await call<{ albumList2?: { album?: SubsonicAlbum[] } }>(ctx, 'getAlbumList2', {
      type: 'newest',
      size: 1,
    });
    const one = r.albumList2?.album?.[0];
    return one
      ? `Connected. Newest album: “${one.name}”.`
      : 'Connected, but the library looks empty — try a library scan on the server.';
  },

  async search(ctx, query) {
    const r = await call<{
      searchResult3?: { song?: SubsonicSong[]; album?: SubsonicAlbum[]; artist?: SubsonicArtist[] };
    }>(ctx, 'search3', { query, songCount: 40, albumCount: 20, artistCount: 10 });

    const res = r.searchResult3 ?? {};
    return [
      ...(res.album ?? []).map((a) => albumEntry(ctx, a)),
      ...(res.artist ?? []).map((a) => artistEntry(ctx, a)),
      ...(res.song ?? []).map((s) => songEntry(ctx, s)),
    ];
  },
};
