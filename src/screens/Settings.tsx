import { useEffect, useState } from 'react';
import { ACTION_LABELS, prettyKeyLabel } from '../input/defaults';
import { input } from '../input/manager';
import type { DriverState, RawSignal } from '../input/types';
import { Button, Chip, Row, Spinner } from '../components/primitives';
import { FocusGroup } from '../focus';
import { api } from '../lib/api';
import { useT } from '../lib/i18n';
import { useApp } from '../store/app';
import { CalibrationWizard, PhonePairing } from './Pairing';

/**
 * Settings.
 *
 * Includes a live input monitor, which exists because "my remote button does
 * nothing" is unanswerable without knowing what code that button actually sends.
 * Showing the raw signal turns a support conversation into a two-second fix.
 */
export function SettingsScreen() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const signOut = useApp((s) => s.signOut);
  const user = useApp((s) => s.user);
  const remoteProfiles = useApp((s) => s.remoteProfiles);
  const setRemoteProfiles = useApp((s) => s.setRemoteProfiles);
  const toast = useApp((s) => s.toast);
  const t = useT();

  const [pane, setPane] = useState<'main' | 'calibrate' | 'phone'>('main');
  const [states, setStates] = useState<DriverState[]>(() => input.states());
  const [recent, setRecent] = useState<RawSignal[]>([]);
  const [health, setHealth] = useState<{ ok: boolean; checks: Record<string, string> } | null>(null);
  const [clearing, setClearing] = useState(false);

  useEffect(() => input.onDriverStates(setStates), []);

  useEffect(
    () =>
      input.onSignalSeen((signal) => {
        if (signal.phase !== 'down') return;
        setRecent((prev) => [signal, ...prev.filter((s) => s.code !== signal.code)].slice(0, 6));
      }),
    [],
  );

  useEffect(() => {
    void api
      .health()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  if (pane === 'calibrate') {
    return <CalibrationWizard onDone={() => setPane('main')} onCancel={() => setPane('main')} />;
  }
  if (pane === 'phone') {
    return <PhonePairing onDone={() => setPane('main')} />;
  }

  const mapping = input.getMapping();

  return (
    <div className="screen__scroll">
      <header className="pad-gutter stack stack-xs">
        <p className="t-label">{t('set.title')}</p>
        <h1 className="t-title">{t('set.heading')}</h1>
      </header>

      {/* ------------------------------ Remote ------------------------------ */}
      <section className="pad-gutter mt-lg stack stack-sm">
        <h2 className="t-section">{t('set.remote')}</h2>
        <div className="pair__drivers">
          {states.map((state) => (
            <div
              key={state.id}
              className="driver"
              data-connected={state.connected}
              data-unsupported={!state.supported}
            >
              <span className="driver__dot" aria-hidden="true" />
              <div className="driver__body">
                <p className="driver__name">
                  {state.label}
                  {state.connected ? <Chip tone="live">Live</Chip> : null}
                  {!state.supported ? <Chip tone="bad">Unavailable</Chip> : null}
                </p>
                {state.deviceName ? <p className="t-meta">{state.deviceName}</p> : null}
                {state.caveat ? <p className="driver__caveat">{state.caveat}</p> : null}
              </div>
            </div>
          ))}
        </div>

        <FocusGroup name="remote-actions">
          <div className="inline inline-sm wrap">
            <Button variant="primary" priority={6} onSelect={() => setPane('calibrate')}>
              {t('set.recalibrate')}
            </Button>
            <Button onSelect={() => setPane('phone')}>{t('set.pairPhone')}</Button>
            {remoteProfiles.length ? (
              <Button
                variant="ghost"
                onSelect={async () => {
                  try {
                    const res = await api.deleteRemoteProfile(remoteProfiles[0].id);
                    setRemoteProfiles(res.profiles);
                    input.setMapping({});
                    toast(t('set.resetDone'), 'good');
                  } catch {
                    toast(t('set.resetFail'), 'bad');
                  }
                }}
              >
                {t('set.resetLayout')}
              </Button>
            ) : null}
          </div>
        </FocusGroup>

        {/* Live input monitor */}
        <div className="glass panel stack stack-xs mt-sm">
          <p className="t-label">{t('set.liveMonitor')}</p>
          {recent.length ? (
            <div className="stack stack-xs">
              {recent.map((signal) => {
                const action = mapping[signal.code];
                return (
                  <p key={signal.code} className="t-body">
                    <code className="warm">{signal.code}</code>{' '}
                    <span className="faint">({prettyKeyLabel(signal.label)})</span> →{' '}
                    {action ? (
                      <strong>{ACTION_LABELS[action]}</strong>
                    ) : (
                      <span className="faint">{t('set.notMapped')}</span>
                    )}
                  </p>
                );
              })}
            </div>
          ) : (
            <p className="t-body">{t('set.liveEmpty')}</p>
          )}
        </div>
      </section>

      {/* ---------------------------- Appearance ---------------------------- */}
      <section className="pad-gutter mt-lg stack stack-sm">
        <h2 className="t-section">{t('set.appearance')}</h2>
        <FocusGroup name="appearance">
          <div className="rows" style={{ padding: 0 }}>
            <Row
              lead={<span aria-hidden="true">◐</span>}
              title={t('set.screensaver')}
              subtitle={
                settings.screensaverEnabled
                  ? t('set.screensaverSub', { n: settings.screensaverMinutes })
                  : t('set.off')
              }
              tail={<Chip>{settings.screensaverEnabled ? t('set.on') : t('set.off')}</Chip>}
              onSelect={() => void setSettings({ screensaverEnabled: !settings.screensaverEnabled })}
            />
            <Row
              lead={<span aria-hidden="true">⏱</span>}
              title={t('set.screensaverDelay')}
              subtitle={t('set.screensaverDelaySub')}
              tail={<span className="t-num">{t('set.minutes', { n: settings.screensaverMinutes })}</span>}
              onSelect={() => {
                const steps = [1, 2, 5, 10, 20, 30, 60];
                const next = steps[(steps.indexOf(settings.screensaverMinutes) + 1) % steps.length];
                void setSettings({ screensaverMinutes: next });
              }}
            />
            <Row
              lead={<span aria-hidden="true">≈</span>}
              title={t('set.reduceMotion')}
              subtitle={t('set.reduceMotionSub')}
              tail={<Chip>{settings.reduceMotion ? t('set.on') : t('set.off')}</Chip>}
              onSelect={() => void setSettings({ reduceMotion: !settings.reduceMotion })}
            />
            <Row
              lead={<span aria-hidden="true">⊕</span>}
              title={t('set.uiScale')}
              subtitle={t('set.uiScaleSub')}
              tail={<span className="t-num">{Math.round(settings.uiScale * 100)}%</span>}
              onSelect={() => {
                const steps = [0.85, 0.95, 1, 1.1, 1.25, 1.4];
                const next = steps[(steps.indexOf(settings.uiScale) + 1) % steps.length];
                void setSettings({ uiScale: next });
              }}
            />
            <Row
              lead={<span aria-hidden="true">◷</span>}
              title={t('set.clock')}
              subtitle={t('set.clockSub')}
              tail={<Chip>{settings.clock24h ? t('set.clock24') : t('set.clock12')}</Chip>}
              onSelect={() => void setSettings({ clock24h: !settings.clock24h })}
            />
            <Row
              lead={<span aria-hidden="true">言</span>}
              title={t('set.language')}
              subtitle={t('set.languageSub')}
              tail={<Chip>{settings.language === 'zh' ? '简体中文' : 'English'}</Chip>}
              onSelect={() => void setSettings({ language: settings.language === 'zh' ? 'en' : 'zh' })}
            />
          </div>
        </FocusGroup>
      </section>

      {/* ----------------------------- Playback ----------------------------- */}
      <section className="pad-gutter mt-lg stack stack-sm">
        <h2 className="t-section">{t('set.playback')}</h2>
        <FocusGroup name="playback-settings">
          <div className="rows" style={{ padding: 0 }}>
            <Row
              lead={<span aria-hidden="true">⤢</span>}
              title={t('set.fullscreen')}
              subtitle={t('set.fullscreenSub')}
              tail={<Chip>{settings.fullscreen ? t('set.on') : t('set.off')}</Chip>}
              onSelect={() => void setSettings({ fullscreen: !settings.fullscreen })}
            />
            <Row
              lead={<span aria-hidden="true">⏭</span>}
              title={t('set.autoplay')}
              subtitle={t('set.autoplaySub')}
              tail={<Chip>{settings.autoplayNext ? t('set.on') : t('set.off')}</Chip>}
              onSelect={() => void setSettings({ autoplayNext: !settings.autoplayNext })}
            />
            <Row
              lead={<span aria-hidden="true">↔</span>}
              title={t('set.seekStep')}
              subtitle={t('set.seekStepSub')}
              tail={<span className="t-num">{t('set.seconds', { n: settings.seekStepSeconds })}</span>}
              onSelect={() => {
                const steps = [5, 10, 15, 30, 60];
                const next = steps[(steps.indexOf(settings.seekStepSeconds) + 1) % steps.length];
                void setSettings({ seekStepSeconds: next });
              }}
            />
            <Row
              lead={<span aria-hidden="true">⌫</span>}
              title={t('set.clearProgress')}
              subtitle={t('set.clearProgressSub')}
              tail={clearing ? <Spinner /> : <Chip tone="warn">{t('set.clearCareful')}</Chip>}
              onSelect={async () => {
                setClearing(true);
                try {
                  await api.clearProgress();
                  await useApp.getState().refreshProgress();
                  toast(t('set.clearDone'), 'good');
                } catch {
                  toast(t('set.clearFail'), 'bad');
                } finally {
                  setClearing(false);
                }
              }}
            />
          </div>
        </FocusGroup>
      </section>

      {/* ------------------------------ Account ----------------------------- */}
      <section className="pad-gutter mt-lg stack stack-sm">
        <h2 className="t-section">{t('set.account')}</h2>
        <div className="glass panel stack stack-xs">
          <p className="t-body">
            {t('set.signedIn')} <strong>{user?.displayName ?? '—'}</strong>{' '}
            <span className="faint">({user?.username})</span>
          </p>
          {health ? (
            <p className="t-meta">
              Server {health.ok ? t('set.serverHealthy') : t('set.serverProblem')} ·{' '}
              {t('set.database')} {health.checks.database} · {t('set.encryptionKey')} {health.checks.encryptionKey}
            </p>
          ) : (
            <p className="t-meta">{t('set.checkingServer')}</p>
          )}
        </div>
        <FocusGroup name="account-actions">
          <div className="inline inline-sm wrap">
            <Button variant="danger" onSelect={() => void signOut()}>
              {t('set.signOut')}
            </Button>
          </div>
        </FocusGroup>
      </section>

      {/* ------------------------------- About ------------------------------ */}
      <section className="pad-gutter mt-lg stack stack-sm">
        <h2 className="t-section">{t('set.about')}</h2>
        <div className="glass panel stack stack-sm">
          <p className="t-body">{t('set.aboutBody')}</p>
          <div>
            <p className="t-label">{t('set.aboutBluetooth')}</p>
            <p className="t-body">{t('set.aboutBluetoothBody')}</p>
          </div>
          <div>
            <p className="t-label">{t('set.aboutPrivacy')}</p>
            <p className="t-body">{t('set.aboutPrivacyBody')}</p>
          </div>
        </div>
      </section>

      <div style={{ height: '4vh' }} />
    </div>
  );
}
