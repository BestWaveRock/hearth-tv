import { create } from 'zustand';
import type { Entry } from '../../shared/types';
import { api } from '../lib/api';
import { resolveStreamUrl } from '../lib/media';

export interface PlayItem {
  sourceId: string;
  sourceName?: string;
  entry: Entry;
}

export type RepeatMode = 'off' | 'all' | 'one';

interface PlaybackState {
  /* --- music, which keeps playing while you browse ------------------- */
  queue: PlayItem[];
  index: number;
  playing: boolean;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  audioError: string | null;

  /* --- video, which is a modal takeover ------------------------------ */
  video: { items: PlayItem[]; index: number; startAt: number } | null;

  playTracks: (items: PlayItem[], index: number) => void;
  toggle: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  seekBy: (delta: number) => void;
  seekTo: (seconds: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  cycleRepeat: () => void;
  toggleShuffle: () => void;
  stopAudio: () => void;

  openVideo: (items: PlayItem[], index: number, startAt?: number) => void;
  closeVideo: () => void;
  advanceVideo: () => boolean;

  currentTrack: () => PlayItem | null;
}

/**
 * One <audio> element for the whole app, created outside React.
 *
 * This is deliberate: if the element lived inside a component it would be torn
 * down on navigation, and music would stop the moment you opened a folder. A
 * module singleton is the only way to keep playback alive across screens.
 */
const audio: HTMLAudioElement | null = typeof Audio === 'undefined' ? null : new Audio();
if (audio) {
  audio.preload = 'metadata';
  // Deliberately no `crossOrigin`. Stream URLs are same-origin, so the session
  // cookie is sent either way — but setting crossOrigin would force CORS mode,
  // and OpenList streams are a 302 to the provider's CDN, which will never send
  // Access-Control-Allow-Origin. Leaving it unset keeps those redirects playable.
}

let lastSavedAt = 0;

/** Persists resume position, but at most once every 8 seconds. */
function saveProgress(item: PlayItem, position: number, duration: number, force = false): void {
  if (!Number.isFinite(position) || position < 5) return;
  const now = Date.now();
  if (!force && now - lastSavedAt < 8000) return;
  lastSavedAt = now;
  void api
    .saveProgress({
      sourceId: item.sourceId,
      path: item.entry.path,
      title: item.entry.title || item.entry.name,
      kind: item.entry.kind === 'track' ? 'track' : 'video',
      position,
      duration,
    })
    .catch(() => undefined);
}

export const usePlayback = create<PlaybackState>((set, get) => ({
  queue: [],
  index: -1,
  playing: false,
  position: 0,
  duration: 0,
  volume: 1,
  muted: false,
  shuffle: false,
  repeat: 'off',
  audioError: null,
  video: null,

  playTracks(items, index) {
    if (!audio || !items.length) return;
    const safeIndex = Math.max(0, Math.min(index, items.length - 1));
    set({ queue: items, index: safeIndex, audioError: null, position: 0, duration: 0 });
    loadCurrent(true);
  },

  toggle() {
    if (!audio) return;
    if (get().index < 0) return;
    if (audio.paused) void audio.play().catch(reportAudioError);
    else audio.pause();
  },

  pause() {
    audio?.pause();
  },

  next() {
    const { queue, index, shuffle, repeat } = get();
    if (!queue.length) return;
    if (repeat === 'one') {
      if (audio) audio.currentTime = 0;
      void audio?.play().catch(reportAudioError);
      return;
    }
    let nextIndex: number;
    if (shuffle) nextIndex = randomOther(queue.length, index);
    else nextIndex = index + 1;

    if (nextIndex >= queue.length) {
      if (repeat === 'all') nextIndex = 0;
      else {
        audio?.pause();
        return;
      }
    }
    set({ index: nextIndex, position: 0, duration: 0 });
    loadCurrent(true);
  },

  previous() {
    const { queue, index, position } = get();
    if (!queue.length || !audio) return;
    // Standard behaviour: restart the track unless you press it early.
    if (position > 4) {
      audio.currentTime = 0;
      return;
    }
    const prev = index - 1 < 0 ? queue.length - 1 : index - 1;
    set({ index: prev, position: 0, duration: 0 });
    loadCurrent(true);
  },

  seekBy(delta) {
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + delta));
  },

  seekTo(seconds) {
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration, seconds));
  },

  setVolume(v) {
    const clamped = Math.max(0, Math.min(1, v));
    if (audio) audio.volume = clamped;
    set({ volume: clamped, muted: clamped === 0 });
  },

  toggleMute() {
    if (!audio) return;
    const muted = !audio.muted;
    audio.muted = muted;
    set({ muted });
  },

  cycleRepeat() {
    const order: RepeatMode[] = ['off', 'all', 'one'];
    const nextMode = order[(order.indexOf(get().repeat) + 1) % order.length];
    set({ repeat: nextMode });
  },

  toggleShuffle() {
    set({ shuffle: !get().shuffle });
  },

  stopAudio() {
    if (!audio) return;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    set({ queue: [], index: -1, playing: false, position: 0, duration: 0 });
  },

  openVideo(items, index, startAt = 0) {
    // Video takes the room's attention; music steps aside.
    audio?.pause();
    set({ video: { items, index, startAt } });
  },

  closeVideo() {
    set({ video: null });
  },

  advanceVideo() {
    const { video } = get();
    if (!video) return false;
    // Only advance within playable siblings, so a folder of extras does not
    // silently start playing a subtitle file.
    const nextIndex = video.index + 1;
    if (nextIndex >= video.items.length) return false;
    set({ video: { items: video.items, index: nextIndex, startAt: 0 } });
    return true;
  },

  currentTrack() {
    const { queue, index } = get();
    return index >= 0 && index < queue.length ? queue[index] : null;
  },
}));

function randomOther(length: number, exclude: number): number {
  if (length <= 1) return 0;
  let candidate = exclude;
  while (candidate === exclude) candidate = Math.floor(Math.random() * length);
  return candidate;
}

function reportAudioError(err: unknown): void {
  const message =
    err instanceof Error && err.name === 'NotAllowedError'
      ? 'The browser blocked playback until you interact with the page — press OK once.'
      : 'This track could not be played.';
  usePlayback.setState({ audioError: message, playing: false });
}

/**
 * Resolving a stream URL is asynchronous in direct mode: OpenList has to be asked
 * for a fresh pre-signed link, and Subsonic credentials must be read first. The
 * generation counter guards against a slow resolve for a skipped-past track
 * overwriting the source of the one now playing.
 */
let loadGeneration = 0;

function loadCurrent(autoplay: boolean): void {
  const state = usePlayback.getState();
  const item = state.currentTrack();
  if (!audio || !item) return;

  const generation = ++loadGeneration;
  updateMediaSession(item);

  void resolveStreamUrl(item.sourceId, item.entry.path)
    .then((url) => {
      if (generation !== loadGeneration || !audio) return;
      audio.src = url;
      audio.load();
      if (autoplay) void audio.play().catch(reportAudioError);
    })
    .catch((err: unknown) => {
      if (generation !== loadGeneration) return;
      usePlayback.setState({
        playing: false,
        audioError: err instanceof Error ? err.message : 'Could not resolve that track.',
      });
    });
}

/* --------------------------- element wiring ---------------------------- */

if (audio) {
  audio.addEventListener('play', () => usePlayback.setState({ playing: true, audioError: null }));
  audio.addEventListener('pause', () => usePlayback.setState({ playing: false }));

  audio.addEventListener('timeupdate', () => {
    usePlayback.setState({ position: audio.currentTime });
    const item = usePlayback.getState().currentTrack();
    if (item) saveProgress(item, audio.currentTime, audio.duration || 0);
  });

  audio.addEventListener('loadedmetadata', () => {
    usePlayback.setState({
      duration: Number.isFinite(audio.duration) ? audio.duration : 0,
    });
  });

  audio.addEventListener('ended', () => {
    const item = usePlayback.getState().currentTrack();
    if (item) saveProgress(item, audio.duration || 0, audio.duration || 0, true);
    usePlayback.getState().next();
  });

  audio.addEventListener('error', () => {
    const item = usePlayback.getState().currentTrack();
    usePlayback.setState({
      playing: false,
      audioError: item
        ? `“${item.entry.title || item.entry.name}” could not be played. The format may not be supported by this browser.`
        : 'Playback failed.',
    });
  });
}

/**
 * Media Session integration.
 *
 * This is what makes the physical media keys on a keyboard or remote control
 * *this* app rather than whatever else the OS decides, and it puts the album
 * art on the lock screen. Worth the twenty lines.
 */
function updateMediaSession(item: PlayItem): void {
  if (!('mediaSession' in navigator)) return;
  const entry = item.entry;
  const artwork = entry.art
    ? [{ src: new URL(entry.art, location.origin).toString(), sizes: '512x512', type: 'image/jpeg' }]
    : [];

  navigator.mediaSession.metadata = new MediaMetadata({
    title: entry.title || entry.name,
    artist: entry.artist ?? item.sourceName ?? '',
    album: entry.album ?? '',
    artwork,
  });

  const store = usePlayback.getState();
  const handlers: [MediaSessionAction, () => void][] = [
    ['play', () => store.toggle()],
    ['pause', () => store.pause()],
    ['nexttrack', () => usePlayback.getState().next()],
    ['previoustrack', () => usePlayback.getState().previous()],
    ['seekbackward', () => usePlayback.getState().seekBy(-10)],
    ['seekforward', () => usePlayback.getState().seekBy(10)],
  ];
  for (const [action, handler] of handlers) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // Not every action is implemented in every browser.
    }
  }
}

export { saveProgress };
