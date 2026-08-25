import { useCallback } from 'react';
import type { Entry } from '../../shared/types';
import { useApp } from '../store/app';
import { usePlayback, type PlayItem } from '../store/playback';

const NAVIGABLE = new Set<Entry['kind']>(['folder', 'album', 'artist', 'playlist']);

export function isPlayable(entry: Entry): boolean {
  return entry.kind === 'video' || entry.kind === 'track';
}

/**
 * One decision point for "the user pressed OK on a thing".
 *
 * Folders, albums, artists and playlists navigate. Videos take over the screen.
 * Tracks join a queue built from their siblings, so pressing OK on track 3 of an
 * album plays the rest of the album afterwards — which is what anyone expects
 * and what a naive "play this one file" implementation gets wrong.
 */
export function useOpenEntry() {
  const push = useApp((s) => s.push);
  const openVideo = usePlayback((s) => s.openVideo);
  const playTracks = usePlayback((s) => s.playTracks);

  return useCallback(
    (
      entry: Entry,
      sourceId: string,
      context?: { siblings?: Entry[]; sourceName?: string; resumeAt?: number },
    ) => {
      if (NAVIGABLE.has(entry.kind)) {
        push({
          name: 'browse',
          sourceId,
          path: entry.path,
          title: entry.title || entry.name,
        });
        return;
      }

      const siblings = context?.siblings ?? [entry];
      const sourceName = context?.sourceName;

      if (entry.kind === 'video') {
        const videos = siblings.filter((e) => e.kind === 'video');
        const list: PlayItem[] = (videos.length ? videos : [entry]).map((e) => ({
          sourceId,
          sourceName,
          entry: e,
        }));
        const index = Math.max(
          0,
          list.findIndex((i) => i.entry.path === entry.path),
        );
        openVideo(list, index, context?.resumeAt ?? 0);
        return;
      }

      if (entry.kind === 'track') {
        const tracks = siblings.filter((e) => e.kind === 'track');
        const list: PlayItem[] = (tracks.length ? tracks : [entry]).map((e) => ({
          sourceId,
          sourceName,
          entry: e,
        }));
        const index = Math.max(
          0,
          list.findIndex((i) => i.entry.path === entry.path),
        );
        playTracks(list, index);
        push({ name: 'nowplaying' });
      }
    },
    [openVideo, playTracks, push],
  );
}
