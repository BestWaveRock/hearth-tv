import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { RemoteAction } from '../shared/types';
import { Ambient } from './components/Ambient';
import { ControlCentre } from './components/ControlCentre';
import { Screensaver } from './components/Screensaver';
import { Toasts } from './components/Toasts';
import { TopBar } from './components/TopBar';
import { engine } from './focus';
import { input } from './input/manager';
import { dismissTop } from './lib/dismiss';
import { enterFullscreen, installBrowserGuards, isFullscreen, isNativeShell } from './lib/guards';
import { useT } from './lib/i18n';
import { AuthScreen } from './screens/Auth';
import { BrowseScreen } from './screens/Browse';
import { HomeScreen } from './screens/Home';
import { NowPlayingScreen } from './screens/NowPlaying';
import { PairingScreen } from './screens/Pairing';
import { PhoneRemote } from './screens/PhoneRemote';
import { SearchScreen } from './screens/Search';
import { SettingsScreen } from './screens/Settings';
import { SourcesScreen } from './screens/Sources';
import { VideoPlayer } from './screens/VideoPlayer';
import { useApp, useRoute } from './store/app';
import { usePlayback } from './store/playback';
import { EmptyState, Spinner } from './components/primitives';

export function App() {
  // `/remote/<code>` is the phone remote: a touch surface with none of the TV
  // shell. Matching on the path directly avoids pulling in a router for the one
  // route that is not part of the TV.
  const phoneCode = matchPhoneRoute(location.pathname);
  if (phoneCode) return <PhoneRemote code={phoneCode} />;

  return <TvShell />;
}

function matchPhoneRoute(pathname: string): string | null {
  const m = pathname.match(/^\/remote\/([A-Za-z0-9]{6,12})\/?$/);
  return m ? m[1].toUpperCase() : null;
}

function TvShell() {
  const phase = useApp((s) => s.phase);
  const boot = useApp((s) => s.boot);
  const settings = useApp((s) => s.settings);
  const screensaver = useApp((s) => s.screensaver);
  const setScreensaver = useApp((s) => s.setScreensaver);
  const refreshProgress = useApp((s) => s.refreshProgress);
  const video = usePlayback((s) => s.video);
  const t = useT();

  const [controlCentre, setControlCentre] = useState(false);

  /* --------------------------- boot sequence --------------------------- */

  // Strip out the document-shaped browser behaviours (right-click menus, zoom,
  // swipe-back) that a remote can trigger by accident.
  useEffect(() => installBrowserGuards(), []);

  useEffect(() => {
    void input.start();
    // The manager needs to ask the focus engine two questions without
    // depending on it: what has focus, and would a long press mean anything.
    input.setProbes({
      focus: () => engine.currentIdOf(),
      // A long press always means something here: it opens Control Centre.
      // The manager only fires it if OK did not already navigate away.
      longPress: () => true,
    });
    void boot();
  }, [boot]);

  useEffect(() => {
    if (phase === 'ready') void refreshProgress();
  }, [phase, refreshProgress]);

  /* ------------------------ settings -> document ----------------------- */

  useEffect(() => {
    document.body.dataset.reduceMotion = String(settings.reduceMotion);
    document.documentElement.style.setProperty('--scale', String(settings.uiScale));
    engine.setSmoothScroll(!settings.reduceMotion);
  }, [settings.reduceMotion, settings.uiScale]);

  /* --------------------------- remote routing -------------------------- */

  const handleAction = useCallback(
    (action: RemoteAction) => {
      const app = useApp.getState();

      // 1. The screensaver consumes the press that wakes it.
      if (app.screensaver) {
        setScreensaver(false);
        return;
      }

      // 2. Video owns its own input entirely; it registers a separate listener.
      if (usePlayback.getState().video) return;

      switch (action) {
        case 'up':
        case 'down':
        case 'left':
        case 'right':
          engine.move(action);
          return;

        case 'select':
          engine.select();
          return;

        case 'back':
          // Overlays first, then the navigation stack. Never leave the app.
          if (dismissTop()) return;
          app.pop();
          return;

        case 'home':
          if (dismissTop()) return;
          app.goHome();
          return;

        case 'menu':
          setControlCentre((open) => !open);
          return;

        case 'playpause':
          usePlayback.getState().toggle();
          return;

        case 'next':
          usePlayback.getState().next();
          return;

        case 'prev':
          usePlayback.getState().previous();
          return;

        case 'rewind':
          usePlayback.getState().seekBy(-10);
          return;

        case 'forward':
          usePlayback.getState().seekBy(10);
          return;

        case 'volumeUp':
          usePlayback.getState().setVolume(usePlayback.getState().volume + 0.08);
          return;

        case 'volumeDown':
          usePlayback.getState().setVolume(usePlayback.getState().volume - 0.08);
          return;

        case 'mute':
          usePlayback.getState().toggleMute();
          return;

        case 'power':
          setScreensaver(true);
          return;

        default:
          return;
      }
    },
    [setScreensaver],
  );

  useEffect(() => input.onAction((event) => handleAction(event.action)), [handleAction]);

  /**
   * Honour the immersive-fullscreen preference.
   *
   * `requestFullscreen` requires user activation, so it cannot be called on load.
   * A remote button press *is* user activation, so the first action after boot is
   * the earliest legitimate moment. The native macOS wrapper manages its own
   * window, so it is left alone.
   */
  useEffect(() => {
    if (!settings.fullscreen || isNativeShell()) return;
    const off = input.onAction(() => {
      if (!isFullscreen()) void enterFullscreen();
      off();
    });
    return off;
  }, [settings.fullscreen]);

  /* ---------------------------- screensaver ---------------------------- */

  useEffect(() => {
    if (!settings.screensaverEnabled) {
      setScreensaver(false);
      return;
    }
    // Checking once a second against a timestamp is far cheaper than resetting
    // a long timeout on every single button press.
    const delayMs = settings.screensaverMinutes * 60_000;
    const timer = window.setInterval(() => {
      const app = useApp.getState();
      if (app.screensaver) return;
      if (app.phase !== 'ready') return;
      if (usePlayback.getState().video) return; // never sleep over a film
      if (usePlayback.getState().playing) return; // nor over music
      if (input.idleMs() >= delayMs) app.setScreensaver(true);
    }, 1000);
    return () => clearInterval(timer);
  }, [settings.screensaverEnabled, settings.screensaverMinutes, setScreensaver]);

  // Mouse and touch also count as being awake, for anyone using a trackpad.
  useEffect(() => {
    const wake = () => input.noteActivity();
    window.addEventListener('pointerdown', wake);
    window.addEventListener('pointermove', wake, { passive: true });
    window.addEventListener('wheel', wake, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('wheel', wake);
    };
  }, []);

  /* ------------------------------ rendering ---------------------------- */

  return (
    <>
      <Ambient />
      <div className="app">
        {phase === 'booting' ? (
          <div className="centered">
            <Spinner />
            <p className="t-body mt-md">{t('app.warming')}</p>
          </div>
        ) : phase === 'broken' ? (
          <div className="centered">
            <EmptyState glyph="⚠" title={t('app.broken.title')} body={t('app.broken.body')} />
          </div>
        ) : phase === 'pairing' ? (
          <PairingScreen />
        ) : phase === 'auth' ? (
          <AuthScreen />
        ) : (
          <>
            <TopBar />
            <ScreenRouter />
          </>
        )}
      </div>

      {video ? <VideoPlayer /> : null}
      {controlCentre && phase === 'ready' ? (
        <ControlCentre onClose={() => setControlCentre(false)} />
      ) : null}
      {screensaver ? <Screensaver /> : null}
      <Toasts />
    </>
  );
}

function ScreenRouter() {
  const route = useRoute();

  // The key forces a remount per route, which resets scroll and lets the focus
  // engine claim a fresh initial target instead of restoring a stale one.
  switch (route.name) {
    case 'home':
      return <ScreenFrame key="home" name="home"><HomeScreen /></ScreenFrame>;
    case 'browse':
      return (
        <ScreenFrame key={`browse:${route.sourceId}:${route.path}`} name="browse">
          <BrowseScreen sourceId={route.sourceId} path={route.path} title={route.title} />
        </ScreenFrame>
      );
    case 'search':
      return <ScreenFrame key="search" name="search"><SearchScreen /></ScreenFrame>;
    case 'sources':
      return <ScreenFrame key="sources" name="sources"><SourcesScreen /></ScreenFrame>;
    case 'settings':
      return <ScreenFrame key="settings" name="settings"><SettingsScreen /></ScreenFrame>;
    case 'nowplaying':
      return <ScreenFrame key="nowplaying" name="nowplaying"><NowPlayingScreen /></ScreenFrame>;
    default:
      return null;
  }
}

/**
 * Each screen is its own focus scope, so the top bar and the screen body form a
 * single navigable plane while dialogs opened on top of them cannot be reached
 * by accident.
 */
function ScreenFrame({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="screen" data-screen={name}>
      {children}
    </div>
  );
}
