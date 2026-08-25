import type { Entry, EntryKind, MediaRole, SourceKind } from '../../shared/types';

export interface Credentials {
  username?: string;
  password?: string;
  token?: string;
}

/** Everything an adapter needs, assembled per request from a decrypted row. */
export interface SourceContext {
  id: string;
  kind: SourceKind;
  name: string;
  baseUrl: string;
  rootPath: string;
  media: MediaRole;
  creds: Credentials;
}

/** Where the bytes actually live, plus the headers needed to get at them. */
export interface StreamTarget {
  url: string;
  headers: Record<string, string>;
  /**
   * True when `url` is a pre-signed third-party URL that the browser may be
   * redirected to directly, which keeps large video off our own bandwidth.
   */
  redirectable?: boolean;
  filename?: string;
}

export interface Shelf {
  id: string;
  title: string;
  /** Virtual path to open when the shelf's "see all" is selected. */
  path?: string;
  entries: Entry[];
}

export interface Adapter {
  kind: SourceKind;
  list(ctx: SourceContext, path: string): Promise<Entry[]>;
  stream(ctx: SourceContext, path: string): Promise<StreamTarget>;
  art?(ctx: SourceContext, ref: string, size?: number): Promise<StreamTarget | null>;
  test(ctx: SourceContext): Promise<string>;
  search?(ctx: SourceContext, query: string): Promise<Entry[]>;
  shelves?(ctx: SourceContext): Promise<Shelf[]>;
}

/* ---------------------------- media typing ---------------------------- */

export const VIDEO_EXT = new Set([
  'mp4', 'm4v', 'mkv', 'webm', 'mov', 'avi', 'wmv', 'flv', 'ts', 'm2ts', 'mts',
  'mpg', 'mpeg', 'ogv', '3gp', 'rmvb', 'vob', 'divx', 'f4v', 'm3u8',
]);

export const AUDIO_EXT = new Set([
  'mp3', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'wma', 'alac',
  'aiff', 'aif', 'ape', 'dsf', 'wv', 'mka',
]);

export const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'heic']);

export const SUBTITLE_EXT = new Set(['srt', 'vtt', 'ass', 'ssa', 'sub']);

/**
 * Containers a browser can never decode natively. We surface this as a gentle
 * warning rather than hiding the file, because the user may still have a
 * transcoding proxy in front of their storage.
 */
export const BROWSER_HOSTILE_EXT = new Set(['avi', 'wmv', 'flv', 'rmvb', 'vob', 'divx', 'mpg', 'mpeg']);

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1) return '';
  return name.slice(i + 1).toLowerCase();
}

export function classify(name: string, isDir: boolean): EntryKind {
  if (isDir) return 'folder';
  const ext = extOf(name);
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'track';
  if (IMAGE_EXT.has(ext)) return 'image';
  return 'other';
}

/** Files that should never appear on a TV screen. */
export function isHidden(name: string): boolean {
  if (name.startsWith('.') || name.startsWith('@eaDir')) return true;
  const lower = name.toLowerCase();
  return (
    lower === 'thumbs.db' ||
    lower === 'desktop.ini' ||
    lower === '$recycle.bin' ||
    lower === 'system volume information' ||
    lower.endsWith('.nfo') ||
    lower.endsWith('.part') ||
    lower.endsWith('!qb') ||
    lower.endsWith('.torrent')
  );
}

const RELEASE_NOISE =
  /\b(1080p|2160p|720p|480p|4k|8k|uhd|hdr10\+?|hdr|dolby ?vision|dv|sdr|x264|x265|h ?264|h ?265|hevc|avc|aac|ac3|eac3|dts(?:-hd)?|truehd|atmos|flac|10bit|8bit|bluray|blu-ray|bdrip|bdremux|remux|web-?dl|web-?rip|webrip|hdtv|dvdrip|hdrip|proper|repack|extended|uncut|remastered|internal|limited|multi|dual|dubbed|subbed|complete)\b/gi;

const YEAR = /(?:^|[([\s._-])((?:19|20)\d{2})(?=$|[)\]\s._-])/;

/** Turns `The.Movie.2019.1080p.BluRay.x264-GRP.mkv` into `The Movie`. */
export function cleanTitle(name: string, isDir = false): { title: string; year: number | null } {
  let s = name;
  if (!isDir) {
    const ext = extOf(s);
    if (ext) s = s.slice(0, -(ext.length + 1));
  }

  const yearMatch = s.match(YEAR);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  if (yearMatch && yearMatch.index !== undefined && yearMatch.index > 2) {
    s = s.slice(0, yearMatch.index);
  }

  s = s.replace(/[._]+/g, ' ');
  s = s.replace(/\s*[[(][^)\]]*[)\]]\s*/g, ' ');
  s = s.replace(RELEASE_NOISE, ' ');
  s = s.replace(/-[A-Za-z0-9]{2,12}\s*$/, ' ');
  s = s.replace(/\s{2,}/g, ' ').replace(/^[\s\-–—]+|[\s\-–—]+$/g, '');

  return { title: s || name, year };
}

const EPISODE_TOKEN =
  /[Ss](\d{1,2})[\s._-]?[Ee](\d{1,3})|(?:^|[\s._-])(\d{1,2})x(\d{2,3})(?=$|[\s._-])/;

/** Detects `S01E02` / `1x02` so episodes can be labelled and sorted. */
export function episodeLabel(name: string): string | null {
  const m = name.match(EPISODE_TOKEN);
  if (m) {
    const season = m[1] ?? m[3];
    const episode = m[2] ?? m[4];
    return `S${season.padStart(2, '0')}E${episode.padStart(2, '0')}`;
  }
  const solo = name.match(/(?:^|[\s._-])[Ee][Pp]?[\s._-]?(\d{1,3})(?:$|[\s._-])/);
  return solo ? `E${solo[1].padStart(2, '0')}` : null;
}

/**
 * Turns a filename into what should actually appear on screen.
 *
 * For an episode, the useful title is whatever follows the `SxxExx` token —
 * `Show.S01E01.Pilot.1080p.mkv` should read as "Pilot", not as
 * "Show S01E01 Pilot". If nothing meaningful follows the token, it falls back
 * to the cleaned full name so the tile is never blank.
 */
export function describeFile(
  name: string,
  isDir: boolean,
): { title: string; year: number | null; episode: string | null } {
  const episode = isDir ? null : episodeLabel(name);
  const whole = cleanTitle(name, isDir);

  if (!episode) return { title: whole.title, year: whole.year, episode: null };

  const match = name.match(EPISODE_TOKEN);
  if (match && match.index !== undefined) {
    const tail = name.slice(match.index + match[0].length);
    const cleanedTail = cleanTitle(tail, false);
    // One stray character is noise, not a title.
    if (cleanedTail.title.length > 1) {
      return { title: cleanedTail.title, year: cleanedTail.year ?? whole.year, episode };
    }
  }
  return { title: whole.title, year: whole.year, episode };
}

/* ------------------------------- paths -------------------------------- */

/** Collapses `//`, resolves `..`, guarantees a single leading slash. */
export function normalisePath(p: string): string {
  const parts = (p || '/').split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return '/' + out.join('/');
}

export function parentPath(p: string): string | null {
  const n = normalisePath(p);
  if (n === '/') return null;
  return normalisePath(n.slice(0, n.lastIndexOf('/')) || '/');
}

export function baseName(p: string): string {
  const n = normalisePath(p);
  return n === '/' ? '/' : n.slice(n.lastIndexOf('/') + 1);
}

export function crumbsFor(rootLabel: string, p: string): { name: string; path: string }[] {
  const out = [{ name: rootLabel, path: '/' }];
  let acc = '';
  for (const seg of normalisePath(p).split('/').filter(Boolean)) {
    acc += '/' + seg;
    out.push({ name: decodeURIComponent(seg), path: acc });
  }
  return out;
}

/** Joins URL pieces without ever producing `//` or dropping a path segment. */
export function joinUrl(base: string, ...segments: string[]): string {
  let url = base.replace(/\/+$/, '');
  for (const seg of segments) {
    const clean = normalisePath(seg);
    if (clean === '/') continue;
    url += clean.split('/').map(encodeURIComponent).join('/');
  }
  return url;
}

/** Strips credentials and trailing slashes from user-entered server URLs. */
export function sanitiseBaseUrl(raw: string): string {
  let s = raw.trim();
  if (!s) throw new Error('Server address is required.');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  const u = new URL(s);
  u.username = '';
  u.password = '';
  u.hash = '';
  u.search = '';
  let out = u.toString().replace(/\/+$/, '');
  return out;
}

/* ------------------------------- sorting ------------------------------ */

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Folders first, then natural order so `Ep 2` precedes `Ep 10`. */
export function sortEntries(entries: Entry[]): Entry[] {
  return entries.sort((a, b) => {
    const aDir = a.kind === 'folder' ? 0 : 1;
    const bDir = b.kind === 'folder' ? 0 : 1;
    if (aDir !== bDir) return aDir - bDir;
    if (a.trackNumber != null && b.trackNumber != null && a.trackNumber !== b.trackNumber) {
      return a.trackNumber - b.trackNumber;
    }
    return collator.compare(a.name, b.name);
  });
}

/** Wraps fetch with a timeout so a dead NAS cannot hang the whole request. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 15_000,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, redirect: 'follow' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/abort/i.test(msg)) throw new Error(`Server did not respond within ${timeoutMs / 1000}s.`);
    throw new Error(`Could not reach server: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}
