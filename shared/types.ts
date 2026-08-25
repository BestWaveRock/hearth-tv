/**
 * Types shared verbatim between the Worker and the browser.
 * Keeping one source of truth here is what stops the API and the TV UI
 * from drifting apart.
 */

/** Every physical button on a TV remote, normalised to an intent. */
export type RemoteAction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'select'
  | 'back'
  | 'home'
  | 'menu'
  | 'playpause'
  | 'next'
  | 'prev'
  | 'rewind'
  | 'forward'
  | 'volumeUp'
  | 'volumeDown'
  | 'mute'
  | 'power';

export const REMOTE_ACTIONS: RemoteAction[] = [
  'up', 'down', 'left', 'right', 'select', 'back', 'home', 'menu',
  'playpause', 'next', 'prev', 'rewind', 'forward',
  'volumeUp', 'volumeDown', 'mute', 'power',
];

export type RemoteDriverId = 'keyboard' | 'webhid' | 'gamepad' | 'bluetooth' | 'phone';

/** Maps an opaque hardware signal ("Key:ArrowUp", "hid:12:0x42") to an action. */
export type RemoteMapping = Partial<Record<string, RemoteAction>>;

export interface RemoteProfile {
  id: string;
  name: string;
  driver: RemoteDriverId;
  mapping: RemoteMapping;
  deviceHint?: string | null;
  updatedAt?: number;
}

export type SourceKind = 'webdav' | 'navidrome' | 'openlist';
export type MediaRole = 'video' | 'music' | 'both';

/**
 * How the bytes get from the storage server to the screen.
 *
 * `proxy`  — the Worker talks to the server. Works from anywhere on the
 *            internet, credentials never leave the server, and CORS is a
 *            non-issue because the browser only ever talks to our own origin.
 *            Requires the storage server to be reachable from Cloudflare's
 *            network, so a LAN address will not work.
 *
 * `direct` — the browser talks to the server itself, with no hop through the
 *            Worker. This is what makes a LAN NAS usable: full local bandwidth,
 *            nothing leaves the house, and no proxy in the path. In exchange the
 *            storage server must send CORS headers, and the browser's
 *            mixed-content rule applies (see `directModeBlocker`).
 */
export type AccessMode = 'proxy' | 'direct';

export interface SourceInput {
  kind: SourceKind;
  name: string;
  baseUrl: string;
  rootPath?: string;
  media?: MediaRole;
  access?: AccessMode;
  username?: string;
  password?: string;
  token?: string;
}

/**
 * Server -> client shape.
 *
 * Contains no secret material. Credentials for a `direct` source are fetched
 * separately and deliberately, via `GET /api/sources/:id/credentials`.
 */
export interface SourceSummary {
  id: string;
  kind: SourceKind;
  name: string;
  baseUrl: string;
  rootPath: string;
  media: MediaRole;
  access: AccessMode;
  hasCredentials: boolean;
  usernameMasked: string | null;
  lastOkAt: number | null;
  lastError: string | null;
  createdAt: number;
  sortOrder: number;
}

/** Plaintext credentials, only ever returned for a `direct` source. */
export interface SourceCredentials {
  username?: string;
  password?: string;
  token?: string;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarHue: number;
  createdAt: number;
}

/** One row in a browser listing — a folder, a video, a track, or an album. */
export type EntryKind = 'folder' | 'video' | 'track' | 'album' | 'artist' | 'playlist' | 'image' | 'other';

export interface Entry {
  /** Stable identity within a source. For files this is the path. */
  id: string;
  path: string;
  name: string;
  /** Cleaned-up display title (year/quality tags stripped). */
  title: string;
  kind: EntryKind;
  size?: number;
  mtime?: number;
  duration?: number;
  /** Relative API url for artwork, already signed for this session. */
  art?: string | null;
  subtitle?: string | null;
  year?: number | null;
  trackNumber?: number | null;
  album?: string | null;
  artist?: string | null;
  /** Container/extension, useful for codec warnings. */
  ext?: string | null;
}

export interface Listing {
  sourceId: string;
  path: string;
  parent: string | null;
  entries: Entry[];
  /** Breadcrumb, root-first. */
  crumbs: { name: string; path: string }[];
}

export interface ProgressRow {
  sourceId: string;
  path: string;
  title: string;
  kind: 'video' | 'track';
  position: number;
  duration: number;
  finished: boolean;
  updatedAt: number;
}

export interface FavoriteRow {
  sourceId: string;
  path: string;
  title: string;
  kind: string;
  art: string | null;
  createdAt: number;
}

export type Language = 'en' | 'zh';

export interface Settings {
  screensaverMinutes: number;
  screensaverEnabled: boolean;
  reduceMotion: boolean;
  clock24h: boolean;
  autoplayNext: boolean;
  seekStepSeconds: number;
  uiScale: number;
  ambientSound: boolean;
  /** Display language for the interface. */
  language: Language;
  /** Enter the browser's native fullscreen for video and music playback. */
  fullscreen: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  screensaverMinutes: 5,
  screensaverEnabled: true,
  reduceMotion: false,
  clock24h: true,
  autoplayNext: true,
  seekStepSeconds: 10,
  uiScale: 1,
  ambientSound: false,
  language: 'en',
  fullscreen: false,
};

export interface ApiError {
  error: string;
  detail?: string;
}

/** Messages on the phone-remote WebSocket. */
export type RemoteSocketMessage =
  | { t: 'hello'; role: 'tv' | 'phone'; code: string }
  | { t: 'peers'; tv: boolean; phones: number }
  | { t: 'action'; action: RemoteAction; repeat?: boolean }
  | { t: 'text'; value: string }
  | { t: 'pointer'; dx: number; dy: number }
  | { t: 'state'; title?: string; playing?: boolean; screen?: string }
  | { t: 'ping' }
  | { t: 'pong' };
