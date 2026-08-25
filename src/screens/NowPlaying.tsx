import { useEffect, useState } from 'react';
import { Bars, Button, EmptyState, Row } from '../components/primitives';
import { FocusGroup } from '../focus';
import { formatTime } from '../lib/format';
import { hueFrom } from '../lib/format';
import { useT } from '../lib/i18n';
import { useApp } from '../store/app';
import { usePlayback } from '../store/playback';

/**
 * Now Playing for music.
 *
 * Music has to keep playing while you browse, so the audio element lives in the
 * store rather than in this component — this screen is only a view onto it. The
 * artwork's derived hue is bloomed behind the cover so the room's light changes
 * with the album, which is most of why this screen feels calm.
 */
export function NowPlayingScreen() {
  const queue = usePlayback((s) => s.queue);
  const index = usePlayback((s) => s.index);
  const playing = usePlayback((s) => s.playing);
  const position = usePlayback((s) => s.position);
  const duration = usePlayback((s) => s.duration);
  const repeat = usePlayback((s) => s.repeat);
  const shuffle = usePlayback((s) => s.shuffle);
  const audioError = usePlayback((s) => s.audioError);

  const toggle = usePlayback((s) => s.toggle);
  const next = usePlayback((s) => s.next);
  const previous = usePlayback((s) => s.previous);
  const seekBy = usePlayback((s) => s.seekBy);
  const cycleRepeat = usePlayback((s) => s.cycleRepeat);
  const toggleShuffle = usePlayback((s) => s.toggleShuffle);
  const playTracks = usePlayback((s) => s.playTracks);
  const stopAudio = usePlayback((s) => s.stopAudio);

  const push = useApp((s) => s.push);
  const sources = useApp((s) => s.sources);
  const t = useT();

  const current = index >= 0 ? queue[index] : null;
  const [artFailed, setArtFailed] = useState(false);

  useEffect(() => setArtFailed(false), [current?.entry.path]);

  if (!current) {
    return (
      <div className="screen__scroll">
        <EmptyState glyph="♪" title={t('np.nothing.title')} body={t('np.nothing.body')}>
          <Button
            variant="primary"
            priority={10}
            onSelect={() => {
              const music = sources.find((s) => s.media !== 'video') ?? sources[0];
              if (music) push({ name: 'browse', sourceId: music.id, path: '/', title: music.name });
              else push({ name: 'sources' });
            }}
          >
            {sources.length ? t('np.browseMusic') : t('np.addMusicSource')}
          </Button>
        </EmptyState>
      </div>
    );
  }

  const entry = current.entry;
  const hue = hueFrom(entry.album || entry.title || entry.name);
  const percent = duration > 0 ? (position / duration) * 100 : 0;

  return (
    <div className="screen__scroll">
      <div className="nowplaying">
        <div className="nowplaying__artwrap">
          <div
            className="nowplaying__bloom"
            style={{
              background: `radial-gradient(circle, hsl(${hue} 70% 52% / 0.55), transparent 68%)`,
            }}
            aria-hidden="true"
          />
          <div
            className="nowplaying__art"
            style={
              entry.art && !artFailed
                ? undefined
                : {
                    background: `linear-gradient(155deg, hsl(${hue} 60% 28%), hsl(${hue - 30} 45% 14%))`,
                  }
            }
          >
            {entry.art && !artFailed ? (
              <img src={entry.art} alt="" onError={() => setArtFailed(true)} />
            ) : (
              <span aria-hidden="true">♪</span>
            )}
          </div>
        </div>

        <div className="nowplaying__info">
          <p className="t-label inline inline-sm">
            {playing ? <Bars /> : null}
            {current.sourceName ?? t('np.nowPlaying')}
            {queue.length > 1 ? ` · ${index + 1} / ${queue.length}` : ''}
          </p>
          <h1 className="t-hero clamp-2">{entry.title || entry.name}</h1>
          <p className="t-title dim clamp-1" style={{ fontWeight: 500 }}>
            {entry.artist ?? t('np.unknownArtist')}
          </p>
          {entry.album ? <p className="t-body clamp-1">{entry.album}</p> : null}

          <div className="mt-md">
            <div className="scrub__track" style={{ height: 6 }}>
              <div className="scrub__played" style={{ width: `${Math.min(100, percent)}%` }} />
              <div className="scrub__knob" style={{ left: `${Math.min(100, percent)}%` }} />
            </div>
            <div className="scrub__times mt-sm">
              <span className="t-num">{formatTime(position)}</span>
              <span className="t-num">{formatTime(duration || entry.duration)}</span>
            </div>
          </div>

          {audioError ? <p className="field__error mt-sm">{audioError}</p> : null}

          <FocusGroup name="np-controls">
            <div className="nowplaying__controls">
              <Button iconOnly onSelect={previous} ariaLabel={t('np.prev')}>
                ⏮
              </Button>
              <Button iconOnly onSelect={() => seekBy(-10)} ariaLabel={t('np.back10')}>
                ⏪
              </Button>
              <Button variant="primary" iconOnly priority={10} onSelect={toggle} ariaLabel={t('np.playPause')}>
                {playing ? '❙❙' : '▶'}
              </Button>
              <Button iconOnly onSelect={() => seekBy(10)} ariaLabel={t('np.fwd10')}>
                ⏩
              </Button>
              <Button iconOnly onSelect={next} ariaLabel={t('np.next')}>
                ⏭
              </Button>
              <Button onSelect={toggleShuffle}>{shuffle ? t('np.shuffleOn') : t('np.shuffleOff')}</Button>
              <Button onSelect={cycleRepeat}>
                {repeat === 'off' ? t('np.repeatOff') : repeat === 'all' ? t('np.repeatAll') : t('np.repeatOne')}
              </Button>
              <Button variant="ghost" onSelect={stopAudio}>
                {t('np.stop')}
              </Button>
            </div>
          </FocusGroup>
        </div>
      </div>

      {queue.length > 1 ? (
        <section className="mt-lg">
          <header className="shelf__head">
            <h2 className="t-section">{t('np.upNext')}</h2>
            <span className="shelf__count t-num">{t('np.tracks', { n: queue.length })}</span>
          </header>
          <FocusGroup name="np-queue">
            <div className="rows">
              {queue.map((qItem, i) => (
                <Row
                  key={`${qItem.entry.path}:${i}`}
                  playing={i === index}
                  lead={
                    i === index ? (
                      <Bars paused={!playing} />
                    ) : (
                      <span className="t-num faint">{i + 1}</span>
                    )
                  }
                  title={qItem.entry.title || qItem.entry.name}
                  subtitle={qItem.entry.artist ?? undefined}
                  tail={<span className="t-num">{formatTime(qItem.entry.duration)}</span>}
                  onSelect={() => playTracks(queue, i)}
                />
              ))}
            </div>
          </FocusGroup>
        </section>
      ) : null}
    </div>
  );
}
