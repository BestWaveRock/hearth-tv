import { FocusScope } from '../focus';
import { useDismissable } from '../lib/dismiss';
import { isFullscreen, toggleFullscreen } from '../lib/guards';
import { useApp } from '../store/app';
import { usePlayback } from '../store/playback';
import { Bars, Button, Chip } from './primitives';
import { useNow } from './TopBar';
import { formatClock, formatDay } from '../lib/format';
import { useT } from '../lib/i18n';

/**
 * Control Centre.
 *
 * Opened by the Menu button, or by holding OK. This is what gives the Menu key a
 * real job instead of duplicating Back: the handful of things you want without
 * leaving what you are watching — the screensaver, the current track, and the
 * two screens you actually navigate to.
 */
export function ControlCentre({ onClose }: { onClose: () => void }) {
  const replace = useApp((s) => s.replace);
  const goHome = useApp((s) => s.goHome);
  const setScreensaver = useApp((s) => s.setScreensaver);
  const user = useApp((s) => s.user);
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const t = useT();

  const track = usePlayback((s) => s.currentTrack());
  const playing = usePlayback((s) => s.playing);
  const toggle = usePlayback((s) => s.toggle);

  const now = useNow();
  useDismissable(onClose);

  const go = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-label={t('control.title')}>
      <FocusScope name="control-centre">
        <div className="dialog glass panel" style={{ width: 'min(560px, 92vw)' }}>
          <header className="inline between">
            <div>
              <p className="t-label">{t('control.title')}</p>
              <p className="t-title t-num">{formatClock(now, settings.clock24h)}</p>
              <p className="t-meta">{formatDay(now)}</p>
            </div>
            {user ? <Chip>{user.displayName}</Chip> : null}
          </header>

          {track ? (
            <div className="row" style={{ pointerEvents: 'none' }}>
              <span className="row__lead">{playing ? <Bars /> : '♪'}</span>
              <span className="row__body">
                <span className="row__title clamp-1">{track.entry.title || track.entry.name}</span>
                <span className="row__sub clamp-1">{track.entry.artist ?? track.sourceName}</span>
              </span>
            </div>
          ) : null}

          <div className="dialog__actions">
            {track ? (
              <Button variant="primary" priority={10} onSelect={toggle}>
                {playing ? t('control.pauseMusic') : t('control.resumeMusic')}
              </Button>
            ) : null}
            <Button
              variant={track ? 'default' : 'primary'}
              priority={track ? 0 : 10}
              onSelect={go(() => setScreensaver(true))}
            >
              {t('control.screensaverNow')}
            </Button>
            <Button onSelect={go(goHome)}>{t('control.home')}</Button>
            <Button onSelect={go(() => replace({ name: 'sources' }))}>{t('control.sources')}</Button>
            <Button onSelect={go(() => replace({ name: 'settings' }))}>{t('control.settings')}</Button>
            <Button
              onSelect={() => {
                void toggleFullscreen();
                void setSettings({ fullscreen: !isFullscreen() });
              }}
            >
              {isFullscreen() ? t('control.exitFullscreen') : t('control.fullscreen')}
            </Button>
            <Button
              variant="ghost"
              onSelect={() => void setSettings({ reduceMotion: !settings.reduceMotion })}
            >
              {settings.reduceMotion ? t('control.motionOff') : t('control.motionOn')}
            </Button>
            <Button variant="ghost" onSelect={onClose}>
              {t('control.close')}
            </Button>
          </div>

          <p className="t-meta">{t('control.hint')}</p>
        </div>
      </FocusScope>
    </div>
  );
}
