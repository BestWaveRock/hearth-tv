import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Entry, Listing } from '../../shared/types';
import { Shelf } from '../components/Shelf';
import { Tile } from '../components/Tile';
import { Bars, Button, EmptyState, Row, SkeletonShelf } from '../components/primitives';
import { FocusGroup } from '../focus';
import { ApiError } from '../lib/api';
import { browseSource } from '../lib/media';
import { formatBytes, formatTime } from '../lib/format';
import { useT } from '../lib/i18n';
import { useOpenEntry } from '../lib/open';
import { useApp } from '../store/app';
import { usePlayback } from '../store/playback';

/**
 * The folder browser.
 *
 * It picks its own layout from the contents, which matters because the same
 * screen has to serve three very different shapes of data: a shelf of film
 * posters, an album's track list, and a season of episodes. Guessing wrong makes
 * one of the three unusable, so the rule is explicit — anything track-heavy gets
 * rows, everything else gets a grid.
 */
export function BrowseScreen({
  sourceId,
  path,
  title,
}: {
  sourceId: string;
  path: string;
  title: string;
}) {
  const sources = useApp((s) => s.sources);
  const progress = useApp((s) => s.progress);
  const push = useApp((s) => s.push);
  const pop = useApp((s) => s.pop);
  const toast = useApp((s) => s.toast);
  const openEntry = useOpenEntry();
  const t = useT();

  const currentTrack = usePlayback((s) => s.currentTrack());
  const playing = usePlayback((s) => s.playing);
  const playTracks = usePlayback((s) => s.playTracks);

  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const source = sources.find((s) => s.id === sourceId);
  const sourceName = source?.name ?? title;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setListing(await browseSource(sourceId, path));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('browse.openFail.title'));
    } finally {
      setLoading(false);
    }
  }, [sourceId, path, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const entries = listing?.entries ?? [];

  const shape = useMemo(() => {
    if (!entries.length) return 'grid' as const;
    const tracks = entries.filter((e) => e.kind === 'track').length;
    // Tracks and episodes are read as a list; artwork adds nothing when every
    // row shares the same cover.
    return tracks / entries.length > 0.5 ? ('rows' as const) : ('grid' as const);
  }, [entries]);

  const tracks = useMemo(() => entries.filter((e) => e.kind === 'track'), [entries]);
  const playables = useMemo(
    () => entries.filter((e) => e.kind === 'video' || e.kind === 'track'),
    [entries],
  );

  const resumeFor = (entry: Entry) => {
    const row = progress[`${sourceId}::${entry.path}`];
    if (!row || !row.duration) return undefined;
    return row.position / row.duration;
  };

  return (
    <div className="screen__scroll">
      <header className="pad-gutter stack stack-xs" style={{ paddingTop: '0.4rem' }}>
        <p className="t-label">
          {(listing?.crumbs ?? [{ name: sourceName, path: '/' }])
            .map((c) => c.name)
            .join('  ›  ')}
        </p>
        <div className="inline inline-md wrap between">
          <h1 className="t-title">{title || sourceName}</h1>
          <FocusGroup name="browse-actions">
            <div className="inline inline-sm wrap">
              {playables.length > 1 ? (
                <Button
                  variant="primary"
                  priority={8}
                  icon={<span aria-hidden="true">▶</span>}
                  onSelect={() => {
                    const first = playables[0];
                    if (first.kind === 'track') {
                      playTracks(
                        tracks.map((entry) => ({ sourceId, sourceName, entry })),
                        0,
                      );
                      push({ name: 'nowplaying' });
                    } else {
                      openEntry(first, sourceId, { siblings: entries, sourceName });
                    }
                  }}
                >
                  {t('browse.playAll')}
                </Button>
              ) : null}
              {tracks.length > 1 ? (
                <Button
                  onSelect={() => {
                    const shuffled = [...tracks].sort(() => Math.random() - 0.5);
                    playTracks(
                      shuffled.map((entry) => ({ sourceId, sourceName, entry })),
                      0,
                    );
                    push({ name: 'nowplaying' });
                  }}
                  icon={<span aria-hidden="true">⤮</span>}
                >
                  {t('browse.shuffle')}
                </Button>
              ) : null}
              <Button variant="ghost" onSelect={() => void load()}>
                {t('browse.refresh')}
              </Button>
              {listing?.parent !== null && listing?.parent !== undefined ? (
                <Button variant="ghost" onSelect={() => pop()}>
                  {t('browse.back')}
                </Button>
              ) : null}
            </div>
          </FocusGroup>
        </div>
      </header>

      {loading && !listing ? <SkeletonShelf /> : null}

      {error ? (
        <EmptyState glyph="⚠" title={t('browse.openFail.title')} body={error}>
          <Button variant="primary" priority={10} onSelect={() => void load()}>
            {t('home.tryAgain')}
          </Button>
          <Button variant="ghost" onSelect={() => pop()}>
            {t('browse.goBack')}
          </Button>
        </EmptyState>
      ) : null}

      {!loading && !error && !entries.length ? (
        <EmptyState glyph="◌" title={t('browse.empty.title')} body={t('browse.empty.body')}>
          <Button variant="ghost" priority={10} onSelect={() => pop()}>
            {t('browse.goBack')}
          </Button>
        </EmptyState>
      ) : null}

      {entries.length && shape === 'grid' ? (
        <Shelf title={t('browse.contents')} count={entries.length} grid>
          {entries.map((entry) => (
            <Tile
              key={entry.path}
              entry={entry}
              shape={tileShape(entry)}
              progress={resumeFor(entry)}
              badge={entry.ext && isHostile(entry.ext) ? entry.ext.toUpperCase() : undefined}
              onSelect={() => {
                if (entry.ext && isHostile(entry.ext)) {
                  toast(t('browse.hostile', { ext: entry.ext.toUpperCase() }), 'bad');
                }
                openEntry(entry, sourceId, { siblings: entries, sourceName });
              }}
            />
          ))}
        </Shelf>
      ) : null}

      {entries.length && shape === 'rows' ? (
        <FocusGroup name="browse-rows">
          <div className="rows">
            {entries.map((entry, i) => {
              const isCurrent = currentTrack?.entry.path === entry.path;
              return (
                <Row
                  key={entry.path}
                  playing={isCurrent}
                  lead={
                    isCurrent ? (
                      <Bars paused={!playing} />
                    ) : entry.trackNumber ? (
                      <span className="t-num faint">{entry.trackNumber}</span>
                    ) : (
                      <span aria-hidden="true">{entry.kind === 'folder' ? '▤' : '♪'}</span>
                    )
                  }
                  title={entry.title || entry.name}
                  subtitle={[entry.artist, entry.album].filter(Boolean).join(' · ') || undefined}
                  tail={
                    <>
                      {entry.ext ? <span className="faint">{entry.ext.toUpperCase()}</span> : null}
                      <span>{formatTime(entry.duration) !== '--:--' ? formatTime(entry.duration) : formatBytes(entry.size) ?? ''}</span>
                    </>
                  }
                  priority={i === 0 ? 6 : 0}
                  onSelect={() => openEntry(entry, sourceId, { siblings: entries, sourceName })}
                />
              );
            })}
          </div>
        </FocusGroup>
      ) : null}
    </div>
  );
}

function tileShape(entry: Entry) {
  if (entry.kind === 'album' || entry.kind === 'artist' || entry.kind === 'track') return 'square' as const;
  if (entry.kind === 'video') return 'video' as const;
  return 'poster' as const;
}

/** Containers no browser ships a decoder for. */
const HOSTILE = new Set(['avi', 'wmv', 'flv', 'rmvb', 'vob', 'divx', 'mpg', 'mpeg']);
function isHostile(ext: string): boolean {
  return HOSTILE.has(ext.toLowerCase());
}
