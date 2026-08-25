import { useCallback, useEffect, useState } from 'react';
import type { Entry } from '../../shared/types';
import { Shelf } from '../components/Shelf';
import { Tile } from '../components/Tile';
import { Button, EmptyState, SkeletonShelf } from '../components/primitives';
import { FocusGroup } from '../focus';
import { ApiError, api, type HomeResponse } from '../lib/api';
import { greeting } from '../lib/format';
import { useT } from '../lib/i18n';
import { useOpenEntry } from '../lib/open';
import { useApp } from '../store/app';
import { usePlayback } from '../store/playback';

/**
 * Home.
 *
 * Deliberately shaped like a tvOS home screen: one hero that tells you where
 * you left off, then shelves. Everything comes from a single `/api/home` call so
 * that a slow WebDAV server delays one shelf rather than the whole screen — the
 * server settles each source independently and reports failures separately.
 */
export function HomeScreen() {
  const sources = useApp((s) => s.sources);
  const user = useApp((s) => s.user);
  const push = useApp((s) => s.push);
  const toast = useApp((s) => s.toast);
  const track = usePlayback((s) => s.currentTrack());
  const playing = usePlayback((s) => s.playing);
  const openEntry = useOpenEntry();
  const t = useT();

  const [data, setData] = useState<HomeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.home();
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('home.loadFail.title'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    for (const problem of data?.problems ?? []) {
      toast(`${problem.name}: ${problem.message}`, 'bad');
    }
  }, [data?.problems, toast]);

  if (!sources.length && !loading) {
    return (
      <div className="screen__scroll">
        <EmptyState
          glyph="⛁"
          title={t('home.connect.title')}
          body={t('home.connect.body')}
        >
          <Button variant="primary" priority={10} onSelect={() => push({ name: 'sources' })}>
            {t('home.connect.action')}
          </Button>
        </EmptyState>
      </div>
    );
  }

  const continueShelf = data?.shelves.find((s) => s.id === 'continue');
  const resumeEntry = continueShelf?.entries[0] ?? null;
  const resumeSourceId = continueShelf?.sourceIds?.[0] ?? null;
  const resumeMeta =
    continueShelf?.resume && resumeEntry && resumeSourceId
      ? continueShelf.resume[`${resumeSourceId}::${resumeEntry.path}`]
      : undefined;

  return (
    <div className="screen__scroll">
      <Hero
        greetingText={`${greeting()}${user ? `, ${user.displayName}` : ''}`}
        resume={resumeEntry}
        resumeMeta={resumeMeta}
        nowPlaying={track ? { title: track.entry.title || track.entry.name, playing } : null}
        onResume={() => {
          if (!resumeEntry || !resumeSourceId) return;
          openEntry(resumeEntry, resumeSourceId, { resumeAt: resumeMeta?.position });
        }}
        onBrowse={() => {
          const first = sources[0];
          if (!first) return push({ name: 'sources' });
          push({ name: 'browse', sourceId: first.id, path: '/', title: first.name });
        }}
        onNowPlaying={() => push({ name: 'nowplaying' })}
      />

      {loading && !data ? (
        <>
          <SkeletonShelf />
          <SkeletonShelf count={5} />
        </>
      ) : null}

      {error ? (
        <EmptyState glyph="⚠" title={t('home.loadFail.title')} body={error}>
          <Button variant="primary" onSelect={() => void load()}>
            {t('home.tryAgain')}
          </Button>
        </EmptyState>
      ) : null}

      {data?.shelves.map((shelf) => (
        <Shelf
          key={shelf.id}
          title={shelf.title}
          count={shelf.entries.length >= 18 ? undefined : shelf.entries.length}
          action={
            shelf.path && shelf.sourceId ? (
              <SeeAll
                onSelect={() =>
                  push({
                    name: 'browse',
                    sourceId: shelf.sourceId!,
                    path: shelf.path!,
                    title: shelf.title,
                  })
                }
              />
            ) : null
          }
        >
          {shelf.entries.map((entry, i) => {
            // Continue Watching and Favourites span sources, so each entry
            // carries its own id; single-source shelves fall back to the shelf's.
            const sourceId = shelf.sourceIds?.[i] ?? shelf.sourceId;
            if (!sourceId) return null;
            const resume = shelf.resume?.[`${sourceId}::${entry.path}`];
            return (
              <Tile
                key={`${shelf.id}:${entry.path}:${i}`}
                entry={entry}
                shape={shelfShape(shelf.id, entry)}
                progress={resume && resume.duration ? resume.position / resume.duration : undefined}
                subtitle={
                  resume
                    ? t('home.watched', {
                        p: Math.round((resume.position / (resume.duration || 1)) * 100),
                      })
                    : undefined
                }
                priority={i === 0 ? 4 : 0}
                onSelect={() =>
                  openEntry(entry, sourceId, {
                    siblings: shelf.entries,
                    resumeAt: resume?.position,
                  })
                }
              />
            );
          })}
        </Shelf>
      ))}

      {data && !data.shelves.length && !loading ? (
        <EmptyState glyph="◌" title={t('home.nothing.title')} body={t('home.nothing.body')}>
          <Button variant="primary" onSelect={() => push({ name: 'sources' })}>
            {t('home.reviewSources')}
          </Button>
        </EmptyState>
      ) : null}
    </div>
  );
}

function shelfShape(shelfId: string, entry: Entry) {
  if (shelfId === 'continue') return 'video' as const;
  if (entry.kind === 'album' || entry.kind === 'track' || entry.kind === 'artist') {
    return 'square' as const;
  }
  return 'poster' as const;
}

function SeeAll({ onSelect }: { onSelect: () => void }) {
  const t = useT();
  return (
    <Button variant="ghost" onSelect={onSelect} align="start">
      {t('home.seeAll')}
    </Button>
  );
}

function Hero({
  greetingText,
  resume,
  resumeMeta,
  nowPlaying,
  onResume,
  onBrowse,
  onNowPlaying,
}: {
  greetingText: string;
  resume: Entry | null;
  resumeMeta?: { position: number; duration: number };
  nowPlaying: { title: string; playing: boolean } | null;
  onResume: () => void;
  onBrowse: () => void;
  onNowPlaying: () => void;
}) {
  const t = useT();
  const percent =
    resumeMeta && resumeMeta.duration ? Math.round((resumeMeta.position / resumeMeta.duration) * 100) : null;

  return (
    <section className="hero">
      <div className="hero__glow" aria-hidden="true" />
      <div className="hero__body">
        <p className="t-label">{greetingText}</p>
        <h1 className="t-hero">
          {resume ? resume.title || resume.name : t('home.hero.sitdown')}
        </h1>
        <p className="t-body mt-sm">
          {resume
            ? t('home.hero.resume', { percent: percent !== null ? ` — ${percent}%` : '' })
            : t('home.hero.hint')}
        </p>
      </div>
      <FocusGroup name="hero">
        <div className="hero__actions">
          {resume ? (
            <Button variant="primary" priority={10} onSelect={onResume} icon={<span aria-hidden="true">▶</span>}>
              {t('home.resume')}
            </Button>
          ) : null}
          <Button variant={resume ? 'default' : 'primary'} priority={resume ? 0 : 10} onSelect={onBrowse}>
            {t('home.browseLibrary')}
          </Button>
          {nowPlaying ? (
            <Button variant="ghost" onSelect={onNowPlaying} icon={<span aria-hidden="true">♪</span>}>
              {(nowPlaying.playing ? t('home.nowPlaying') : t('home.paused')) + ` · ${nowPlaying.title}`}
            </Button>
          ) : null}
        </div>
      </FocusGroup>
    </section>
  );
}
