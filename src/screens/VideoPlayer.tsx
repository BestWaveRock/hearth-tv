import { useCallback, useEffect, useRef, useState } from 'react';
import { FocusScope, engine, useFocusable } from '../focus';
import { input } from '../input/manager';
import type { ActionEvent } from '../input/types';
import { api, streamUrl } from '../lib/api';
import { formatTime } from '../lib/format';
import { useT } from '../lib/i18n';
import { useApp } from '../store/app';
import { usePlayback } from '../store/playback';
import { Button, Spinner } from '../components/primitives';

/**
 * Full-screen video.
 *
 * Design constraints that shaped this:
 *
 *  - It must be usable with six buttons. So OK toggles the chrome, left/right
 *    seek when the chrome is hidden and scrub when the bar is focused, and Back
 *    exits. No control needs to be hunted for.
 *  - HLS is loaded lazily. hls.js is ~150 kB and most libraries are plain MP4,
 *    so it is imported only when an .m3u8 actually appears.
 *  - Resume is saved on a timer *and* on unmount, because a browser tab closing
 *    does not give you a reliable last event.
 */
export function VideoPlayer() {
  const video = usePlayback((s) => s.video)!;
  const closeVideo = usePlayback((s) => s.closeVideo);
  const advanceVideo = usePlayback((s) => s.advanceVideo);
  const settings = useApp((s) => s.settings);
  const refreshProgress = useApp((s) => s.refreshProgress);
  const toast = useApp((s) => s.toast);
  const t = useT();

  const item = video.items[video.index];
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideTimer = useRef<number | null>(null);
  const lastSaved = useRef(0);

  const [chromeVisible, setChromeVisible] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(video.startAt);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [waiting, setWaiting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toastText, setToastText] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(
    () => typeof document !== 'undefined' && document.fullscreenElement !== null,
  );

  const title = item.entry.title || item.entry.name;

  /* ------------------------------ fullscreen ---------------------------- */

  const toggleFullscreen = useCallback(() => {
    if (!document.documentElement.requestFullscreen || !document.exitFullscreen) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void document.documentElement.requestFullscreen().catch(() => undefined);
    }
  }, []);

  // Track the real fullscreen state so the control's label stays honest even
  // when the user leaves fullscreen with Esc or a system gesture.
  useEffect(() => {
    const sync = () => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  // When the "open in fullscreen" setting is on, take the whole screen as the
  // player mounts; always release it when the player unmounts.
  useEffect(() => {
    if (settings.fullscreen && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      void document.documentElement.requestFullscreen().catch(() => undefined);
    }
    return () => {
      if (document.fullscreenElement && document.exitFullscreen) {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
  }, [settings.fullscreen]);

  /* ------------------------------ chrome ------------------------------- */

  const showChrome = useCallback(() => {
    setChromeVisible(true);
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setChromeVisible(false), 4200);
  }, []);

  useEffect(() => {
    showChrome();
    return () => {
      if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    };
  }, [showChrome]);

  const flash = useCallback((text: string) => {
    setToastText(text);
    window.setTimeout(() => setToastText((t) => (t === text ? null : t)), 900);
  }, []);

  /* ------------------------------ source ------------------------------- */

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const src = streamUrl(item.sourceId, item.entry.path);
    setError(null);
    setWaiting(true);
    setPosition(video.startAt);
    setDuration(0);

    let destroyHls: (() => void) | undefined;

    if (item.entry.ext === 'm3u8' || src.includes('.m3u8')) {
      // Safari plays HLS natively; everywhere else needs hls.js, imported here
      // so it never lands in the initial bundle.
      if (el.canPlayType('application/vnd.apple.mpegurl')) {
        el.src = src;
      } else {
        void import('hls.js').then(({ default: Hls }) => {
          if (!Hls.isSupported()) {
            setError('This browser cannot play HLS streams.');
            return;
          }
          const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
          hls.loadSource(src);
          hls.attachMedia(el);
          hls.on(Hls.Events.ERROR, (_evt, data) => {
            if (data.fatal) setError(`Stream error: ${data.details}`);
          });
          destroyHls = () => hls.destroy();
        });
      }
    } else {
      el.src = src;
    }

    return () => destroyHls?.();
  }, [item.sourceId, item.entry.path, item.entry.ext, video.startAt]);

  /* ---------------------------- persistence ---------------------------- */

  const save = useCallback(
    (force = false) => {
      const el = videoRef.current;
      if (!el || !Number.isFinite(el.duration) || el.currentTime < 5) return;
      const now = Date.now();
      if (!force && now - lastSaved.current < 10_000) return;
      lastSaved.current = now;
      void api
        .saveProgress({
          sourceId: item.sourceId,
          path: item.entry.path,
          title,
          kind: 'video',
          position: el.currentTime,
          duration: el.duration,
        })
        .catch(() => undefined);
    },
    [item.sourceId, item.entry.path, title],
  );

  useEffect(() => {
    // Unmount is the last reliable moment to record where we got to.
    return () => {
      save(true);
      void refreshProgress();
    };
  }, [save, refreshProgress]);

  /* ------------------------------ controls ----------------------------- */

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play().catch(() => setError('The browser refused to start playback.'));
      flash('▶');
    } else {
      el.pause();
      flash('❙❙');
    }
    showChrome();
  }, [flash, showChrome]);

  const seekBy = useCallback(
    (delta: number) => {
      const el = videoRef.current;
      if (!el || !Number.isFinite(el.duration)) return;
      el.currentTime = Math.max(0, Math.min(el.duration, el.currentTime + delta));
      flash(`${delta > 0 ? '⏩' : '⏪'} ${Math.abs(delta)}s`);
      showChrome();
    },
    [flash, showChrome],
  );

  const exit = useCallback(() => {
    save(true);
    closeVideo();
  }, [save, closeVideo]);

  const goNext = useCallback(() => {
    save(true);
    if (!advanceVideo()) {
      toast('That was the last one in this folder.', 'neutral');
      closeVideo();
    }
  }, [advanceVideo, closeVideo, save, toast]);

  /* --------------------------- remote handling ------------------------- */

  useEffect(() => {
    const handle = (event: ActionEvent) => {
      // The scrub bar reinterprets left/right as seeking while it has focus,
      // which is why it is checked before the generic cases below.
      const scrubFocused = document.activeElement?.classList.contains('scrub') ?? false;

      switch (event.action) {
        case 'playpause':
          togglePlay();
          return;

        case 'back':
          exit();
          return;

        case 'select':
          // Hidden chrome: OK reveals it. Visible chrome: OK activates the
          // focused control, which is what makes the buttons reachable at all.
          if (!chromeVisible) showChrome();
          else engine.select();
          return;

        case 'up':
        case 'down':
          // Vertical movement is always navigation, and always wakes the chrome.
          showChrome();
          engine.move(event.action);
          return;

        case 'left':
        case 'right': {
          const delta = event.action === 'left' ? -settings.seekStepSeconds : settings.seekStepSeconds;
          // With the chrome hidden there is nothing to navigate, so left/right
          // seek. With it visible, the scrub bar seeks and everything else moves.
          if (!chromeVisible) {
            seekBy(delta);
            return;
          }
          if (scrubFocused) {
            seekBy(delta);
            showChrome();
            return;
          }
          engine.move(event.action);
          showChrome();
          return;
        }

        case 'rewind':
          seekBy(-60);
          return;
        case 'forward':
          seekBy(60);
          return;
        case 'next':
          goNext();
          return;
        case 'menu':
          showChrome();
          return;
        default:
          return;
      }
    };
    return input.onAction(handle);
  }, [chromeVisible, exit, goNext, seekBy, settings.seekStepSeconds, showChrome, togglePlay]);

  /* ------------------------------- render ----------------------------- */

  const percent = duration > 0 ? position / duration : 0;

  return (
    <div className="player">
      <video
        ref={videoRef}
        playsInline
        autoPlay
        // No `crossOrigin` attribute on purpose: it would force CORS mode, and
        // an OpenList stream is a 302 to the provider's CDN which sends no CORS
        // headers. Same-origin requests carry the session cookie regardless.
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          setDuration(el.duration);
          if (video.startAt > 0 && video.startAt < el.duration - 10) {
            el.currentTime = video.startAt;
            flash(t('player.resumed', { t: formatTime(video.startAt) }));
          }
        }}
        onTimeUpdate={(e) => {
          setPosition(e.currentTarget.currentTime);
          save();
        }}
        onProgress={(e) => {
          const el = e.currentTarget;
          if (el.buffered.length) setBuffered(el.buffered.end(el.buffered.length - 1));
        }}
        onPlay={() => {
          setPlaying(true);
          setWaiting(false);
        }}
        onPause={() => setPlaying(false)}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onEnded={() => {
          save(true);
          if (settings.autoplayNext) goNext();
          else closeVideo();
        }}
        onError={() => {
          const ext = item.entry.ext?.toUpperCase() ?? 'this file';
          setError(
            `${ext} could not be played. Browsers only decode a limited set of codecs — H.264/AAC in MP4 is the safe combination. The file itself is fine; the browser simply has no decoder for it.`,
          );
        }}
      />

      <FocusScope name="player">
        <div className="player__chrome" data-visible={chromeVisible ? 'true' : 'false'}>
          <div className="player__top">
            <div className="grow">
              <p className="t-label">
                {item.sourceName ?? t('np.nowPlaying')}
                {video.items.length > 1 ? ` · ${video.index + 1} / ${video.items.length}` : ''}
              </p>
              <h1 className="t-title">{title}</h1>
            </div>
            <Button variant="ghost" onSelect={exit}>
              {t('player.done')}
            </Button>
          </div>

          <div className="player__bottom">
            {error ? (
              <div className="glass panel stack stack-xs" style={{ borderColor: 'rgba(255,125,148,0.45)' }}>
                <p className="t-section">{t('player.cannotPlay')}</p>
                <p className="t-body">{error}</p>
                <div className="dialog__actions">
                  <Button variant="primary" onSelect={goNext}>
                    {t('player.skipNext')}
                  </Button>
                  <Button variant="ghost" onSelect={exit}>
                    {t('player.close')}
                  </Button>
                </div>
              </div>
            ) : null}

            <ScrubBar
              percent={percent}
              bufferedPercent={duration > 0 ? buffered / duration : 0}
              position={position}
              duration={duration}
            />

            <div className="player__controls">
              <Button
                iconOnly
                onSelect={() => seekBy(-settings.seekStepSeconds)}
                ariaLabel={t('player.back10', { n: settings.seekStepSeconds })}
              >
                ⏪
              </Button>
              <Button variant="primary" iconOnly priority={10} onSelect={togglePlay} ariaLabel={t('player.playPause')}>
                {playing ? '❙❙' : '▶'}
              </Button>
              <Button
                iconOnly
                onSelect={() => seekBy(settings.seekStepSeconds)}
                ariaLabel={t('player.fwd10', { n: settings.seekStepSeconds })}
              >
                ⏩
              </Button>
              {video.items.length > 1 ? (
                <Button onSelect={goNext}>{t('player.next')}</Button>
              ) : null}
              <Button iconOnly onSelect={toggleFullscreen} ariaLabel={t('player.fullscreen')}>
                {isFullscreen ? '⤢' : '⤡'}
              </Button>
              <span className="player__spacer" />
              <span className="t-meta">
                {item.entry.ext ? item.entry.ext.toUpperCase() : ''}
              </span>
            </div>
          </div>
        </div>
      </FocusScope>

      {waiting && !error ? (
        <div className="player__toast">
          <Spinner />
          {t('player.buffering')}
        </div>
      ) : toastText ? (
        <div className="player__toast">{toastText}</div>
      ) : null}
    </div>
  );
}

/**
 * The scrub bar is a focus target and nothing more.
 *
 * Seeking is handled by the player's single action listener, which knows whether
 * this bar has focus. Keeping the logic in one place avoids the double-seek that
 * two competing listeners would produce.
 */
function ScrubBar({
  percent,
  bufferedPercent,
  position,
  duration,
}: {
  percent: number;
  bufferedPercent: number;
  position: number;
  duration: number;
}) {
  const f = useFocusable<HTMLDivElement>({
    // There is nothing to either side, and the player reads left/right as
    // seeking, so the engine must not try to move focus horizontally.
    overrides: { left: null, right: null },
  });

  const clamped = Math.max(0, Math.min(100, percent * 100));

  return (
    <div
      ref={f.ref}
      className="focusable scrub"
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(position)}
      aria-valuetext={formatTime(position)}
      {...f.props}
    >
      <div className="scrub__track">
        <div
          className="scrub__buffered"
          style={{ width: `${Math.max(0, Math.min(100, bufferedPercent * 100))}%` }}
        />
        <div className="scrub__played" style={{ width: `${clamped}%` }} />
        <div className="scrub__knob" style={{ left: `${clamped}%` }} />
      </div>
      <div
        className="scrub__times"
        style={{ position: 'absolute', bottom: '-1.4rem', left: 0, right: 0 }}
      >
        <span className="t-num">{formatTime(position)}</span>
        <span className="t-num">
          {duration > 0 ? `−${formatTime(duration - position)}` : '--:--'}
        </span>
      </div>
    </div>
  );
}
