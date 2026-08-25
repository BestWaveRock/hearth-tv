import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { RemoteAction, RemoteDriverId } from '../../shared/types';
import { FocusScope, useFocusable } from '../focus';
import { ACTION_LABELS, OPTIONAL_ACTIONS, REQUIRED_ACTIONS } from '../input/defaults';
import { BluetoothDriver } from '../input/drivers/bluetooth';
import { input } from '../input/manager';
import type { DriverState, RawSignal } from '../input/types';
import { api } from '../lib/api';
import { useDismissable } from '../lib/dismiss';
import { useT } from '../lib/i18n';
import { useApp } from '../store/app';
import { Button, Chip, cx } from '../components/primitives';
import { Field } from '../components/Field';

/* ======================================================================== *
 * The pairing gate.
 *
 * This is step one of the product, before sign-in, because a television you
 * cannot control is not a television.
 *
 * ## Why this screen is not just a Bluetooth button
 *
 * The honest answer about `navigator.bluetooth`: it cannot talk to a normal
 * Bluetooth remote. A remote is a HID device, and the HID-over-GATT service
 * (0x1812) is on Chrome's permanent GATT blocklist, because a web page with raw
 * HID access is a keylogger. No flag, no permission, no workaround.
 *
 * What works instead, in descending order of reliability:
 *
 *  1. Pair the remote to the computer's Bluetooth settings. The OS decodes it
 *     and the browser receives real key events. This is how a remote actually
 *     drives a browser, and it needs no permission at all.
 *  2. WebHID, for remotes whose media buttons the OS keeps to itself. Chrome
 *     allows the Consumer Control page, which is where most remote buttons live.
 *  3. The Gamepad API, for air mice and controllers.
 *  4. A phone, over a WebSocket. Always available, and the only sane way to
 *     type a password.
 *  5. Web Bluetooth, for a remote you built yourself with a custom GATT service.
 *
 * So the screen probes all five, reports what it truly found, and refuses to
 * continue until at least one of them has delivered a real button press.
 * ======================================================================== */

type Stage = 'detect' | 'calibrate' | 'phone';

export function PairingScreen() {
  const completePairing = useApp((s) => s.completePairing);
  const bootError = useApp((s) => s.bootError);
  const user = useApp((s) => s.user);
  const toast = useApp((s) => s.toast);
  const t = useT();

  const [stage, setStage] = useState<Stage>('detect');
  const [states, setStates] = useState<DriverState[]>(() => input.states());
  const [lastSignal, setLastSignal] = useState<RawSignal | null>(null);
  const [busy, setBusy] = useState<RemoteDriverId | null>(null);
  const [bleUuid, setBleUuid] = useState(() => BluetoothDriver.customUuid());
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Stable identities. These are passed to the calibration wizard, whose
  // completion effect keys on them; rebuilding them on every render is what
  // caused the wizard to re-save (and re-toast) repeatedly.
  const backToDetect = useCallback(() => setStage('detect'), []);
  const goToPhone = useCallback(() => setStage('phone'), []);
  const goToCalibrate = useCallback(() => setStage('calibrate'), []);

  useEffect(() => input.onDriverStates(setStates), []);

  // A live read-out of raw presses. This is what turns "it doesn't work" into
  // "it works, your remote sends this code", which is a solvable problem.
  useEffect(
    () =>
      input.onSignalSeen((signal) => {
        if (signal.phase === 'down') setLastSignal(signal);
      }),
    [],
  );

  const connected = states.filter((s) => s.connected);
  const ready = connected.length > 0;

  const connect = useCallback(
    async (id: RemoteDriverId) => {
      const driver = input.drivers.find((d) => d.id === id);
      if (!driver?.connect) return;
      setBusy(id);
      try {
        await driver.connect();
        input.rememberDriver(id);
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Could not connect to that device.', 'bad');
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );

  if (stage === 'calibrate') {
    return (
      <CalibrationWizard onDone={backToDetect} onCancel={backToDetect} />
    );
  }

  if (stage === 'phone') {
    return <PhonePairing onDone={backToDetect} />;
  }

  return (
    <FocusScope name="pairing">
      <div className="centered">
        <div className="pair">
          <header className="stack stack-xs">
            <p className="t-label">{t('pair.stepOne')}</p>
            <h1 className="t-hero">{t('pair.pickUp')}</h1>
            <p className="t-body" style={{ maxWidth: '62ch' }}>
              {t('pair.pickUpIntro')}
            </p>
          </header>

          {bootError ? (
            <div className="glass panel stack stack-xs" style={{ borderColor: 'rgba(255,125,148,0.4)' }}>
              <p className="t-section">{t('pair.serverProblem')}</p>
              <p className="t-body">{bootError}</p>
            </div>
          ) : null}

          <div className="listen">
            <span className="listen__pulse" aria-hidden="true" />
            <div className="grow">
              <p className="t-section">
                {lastSignal ? t('pair.detected') : t('pair.listening')}
              </p>
              <p className="t-meta">
                {lastSignal
                  ? `${lastSignal.label} · via ${driverName(lastSignal.driver)}${
                      lastSignal.deviceName ? ` · ${lastSignal.deviceName}` : ''
                    }`
                  : t('pair.listeningMeta')}
              </p>
            </div>
            {ready ? <Chip tone="live">{t('pair.ready')}</Chip> : <Chip tone="warn">{t('pair.waiting')}</Chip>}
          </div>

          <div className="pair__drivers">
            {states.map((state) => (
              <DriverCard
                key={state.id}
                state={state}
                busy={busy === state.id}
                onConnect={
                  state.id === 'phone'
                    ? goToPhone
                    : state.needsPermission
                      ? () => void connect(state.id)
                      : undefined
                }
              />
            ))}
          </div>

          {showAdvanced ? (
            <div className="glass panel stack stack-sm">
              <p className="t-section">{t('pair.customBle')}</p>
              <p className="t-body">{t('pair.customBleBody')}</p>
              <Field
                label={t('pair.serviceUuid')}
                value={bleUuid}
                onChange={(v) => {
                  setBleUuid(v);
                  BluetoothDriver.setCustomUuid(v);
                }}
                placeholder="6e400001-b5a3-f393-e0a9-e50e24dcca9e"
                hint={t('pair.uuidHint')}
              />
            </div>
          ) : null}

          <div className="dialog__actions">
            <Button
              variant="primary"
              disabled={!ready}
              priority={10}
              onSelect={() => {
                if (!ready) return;
                completePairing();
              }}
            >
              {user ? t('pair.continue') : t('pair.continueSignIn')}
            </Button>
            <Button variant="ghost" onSelect={goToCalibrate} disabled={!ready}>
              {t('pair.calibrate')}
            </Button>
            <Button variant="ghost" onSelect={goToPhone}>
              {t('pair.usePhone')}
            </Button>
            <Button variant="ghost" onSelect={() => setShowAdvanced((v) => !v)}>
              {showAdvanced ? t('pair.hideAdvanced') : t('pair.advanced')}
            </Button>
          </div>

          <p className="t-meta">{ready ? t('pair.readyMeta') : t('pair.waitingMeta')}</p>
        </div>
      </div>
    </FocusScope>
  );
}

function driverName(id: RemoteDriverId): string {
  return input.drivers.find((d) => d.id === id)?.label ?? id;
}

function DriverCard({
  state,
  busy,
  onConnect,
}: {
  state: DriverState;
  busy: boolean;
  onConnect?: () => void;
}) {
  const t = useT();
  const selectable = Boolean(onConnect) && state.supported;
  const f = useFocusable<HTMLDivElement>({
    disabled: !selectable,
    onSelect: onConnect,
  });

  return (
    <div
      ref={f.ref}
      className={cx('driver', selectable && 'focusable')}
      data-connected={state.connected}
      data-unsupported={!state.supported}
      {...(selectable ? f.props : {})}
    >
      <span className="driver__dot" aria-hidden="true" />
      <div className="driver__body">
        <p className="driver__name">
          {state.label}
          {state.connected ? <Chip tone="live">{t('pair.connected')}</Chip> : null}
          {!state.supported ? <Chip tone="bad">{t('pair.unavailable')}</Chip> : null}
          {busy ? <Chip tone="warn">{t('pair.opening')}</Chip> : null}
        </p>
        <p className="driver__blurb">{state.blurb}</p>
        {state.deviceName ? <p className="t-meta mt-sm">{state.deviceName}</p> : null}
        {state.caveat ? <p className="driver__caveat">{state.caveat}</p> : null}
        {state.error ? <p className="driver__error">{state.error}</p> : null}
        {selectable ? (
          <p className="t-meta mt-sm">
            {state.id === 'phone' ? t('pair.pressOkQr') : t('pair.pressOkDevice')}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* ======================================================================== *
 * Calibration wizard
 * ======================================================================== */

const WIZARD_STEPS: RemoteAction[] = [...REQUIRED_ACTIONS, ...OPTIONAL_ACTIONS];

export function CalibrationWizard({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const toast = useApp((s) => s.toast);
  const setCalibrating = useApp((s) => s.setCalibrating);
  const setRemoteProfiles = useApp((s) => s.setRemoteProfiles);
  const t = useT();

  const [step, setStep] = useState(0);
  const [mapping, setMapping] = useState<Record<string, RemoteAction>>({});
  const [conflict, setConflict] = useState<string | null>(null);
  const cancelCapture = useRef<(() => void) | null>(null);
  /** Latest mapping, so the capture effect need not re-register on every press. */
  const mappingRef = useRef(mapping);
  mappingRef.current = mapping;
  /** Guarantees the save runs exactly once. See the effect below. */
  const savedRef = useRef(false);

  const action = WIZARD_STEPS[step];
  const isOptional = step >= REQUIRED_ACTIONS.length;
  const done = step >= WIZARD_STEPS.length;

  // Back abandons calibration rather than escaping to whatever is behind it.
  useDismissable(onCancel, !done);

  // The manager swallows every press while capturing, so the UI behind this
  // wizard cannot move as you mash unfamiliar buttons.
  useEffect(() => {
    setCalibrating(true);
    return () => setCalibrating(false);
  }, [setCalibrating]);

  useEffect(() => {
    if (done) return;
    setConflict(null);
    cancelCapture.current?.();
    cancelCapture.current = input.captureNextSignal((signal) => {
      const existing = mappingRef.current[signal.code];
      if (existing && existing !== action) {
        setConflict(t('pair.conflict', { action: ACTION_LABELS[existing] }));
        return;
      }
      setMapping((m) => ({ ...m, [signal.code]: action }));
      setStep((s) => s + 1);
    });
    return () => cancelCapture.current?.();
  }, [step, action, done, t]);

  const save = useCallback(async () => {
    input.setMapping(mappingRef.current);
    try {
      const res = await api.saveRemoteProfile({
        name: 'My Remote',
        driver: input.rememberedDriver() ?? 'keyboard',
        mapping: mappingRef.current,
      });
      setRemoteProfiles(res.profiles);
      toast(t('pair.savedAccount'), 'good');
    } catch {
      // Saved locally regardless, so the remote still works on this machine.
      toast(t('pair.savedLocal'), 'neutral');
    }
    onDone();
  }, [onDone, setRemoteProfiles, toast, t]);

  /**
   * Fire the save exactly once.
   *
   * The ref guard is load-bearing, not defensive. `save` changes identity
   * whenever `onDone` does, and the parent screens rebuild `onDone` on every
   * render — the pairing screen re-renders on every driver-state update and
   * every raw button press. Without the guard, each of those re-ran this effect
   * and produced another "calibrated" toast, forever.
   */
  useEffect(() => {
    if (!done || savedRef.current) return;
    savedRef.current = true;
    void save();
  }, [done, save]);

  const progress = useMemo(
    () =>
      WIZARD_STEPS.map((a, i) => ({
        action: a,
        state: i < step ? 'done' : i === step ? 'active' : 'todo',
      })),
    [step],
  );

  if (done) {
    return (
      <div className="centered">
        <div className="calib">
          <p className="t-label">{t('pair.saving')}</p>
          <h1 className="t-title">{t('pair.calibDone')}</h1>
        </div>
      </div>
    );
  }

  return (
    <FocusScope name="calibrate">
      <div className="centered">
        <div className="calib">
          <p className="t-label">
            {t('pair.calibrating', { n: step + 1, total: WIZARD_STEPS.length })}
          </p>
          <p className="t-body">{t('pair.pressFor')}</p>
          <div className="calib__target">{ACTION_LABELS[action]}</div>

          <DpadDiagram current={action} mapped={new Set(Object.values(mapping))} />

          <div className="calib__steps">
            {progress.map((p) => (
              <span key={p.action} className="calib__step" data-state={p.state} />
            ))}
          </div>

          {conflict ? <p className="field__error">{conflict}</p> : null}

          <div className="dialog__actions center">
            {isOptional ? (
              <Button variant="ghost" onSelect={() => setStep((s) => s + 1)}>
                {t('pair.skip')}
              </Button>
            ) : null}
            {step > 0 ? (
              <Button variant="ghost" onSelect={() => setStep((s) => Math.max(0, s - 1))}>
                {t('pair.backStep')}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              onSelect={() => {
                cancelCapture.current?.();
                onCancel();
              }}
            >
              {t('pair.cancel')}
            </Button>
          </div>

          <p className="t-meta">{isOptional ? t('pair.optionalHint') : t('pair.captureHint')}</p>
        </div>
      </div>
    </FocusScope>
  );
}

/** Visual confirmation of which buttons are already learned. */
function DpadDiagram({ current, mapped }: { current: RemoteAction; mapped: Set<RemoteAction> }) {
  const cell = (action: RemoteAction | null, glyph: string) => {
    if (!action) return <span className="calib__cell calib__cell--blank" />;
    const state = current === action ? 'active' : mapped.has(action) ? 'done' : 'todo';
    return (
      <span className="calib__cell" data-state={state} title={ACTION_LABELS[action]}>
        {state === 'done' && current !== action ? '✓' : glyph}
      </span>
    );
  };

  return (
    <div className="calib__dpad" aria-hidden="true">
      {cell('back', '↩')}
      {cell('up', '▲')}
      {cell('menu', '≡')}
      {cell('left', '◀')}
      {cell('select', 'OK')}
      {cell('right', '▶')}
      {cell('home', '⌂')}
      {cell('down', '▼')}
      {cell('playpause', '⏯')}
    </div>
  );
}

/* ======================================================================== *
 * Phone pairing
 * ======================================================================== */

export function PhonePairing({ onDone }: { onDone: () => void }) {
  const toast = useApp((s) => s.toast);
  const user = useApp((s) => s.user);
  const t = useT();
  const [code, setCode] = useState<string | null>(input.phone.pairingCode);
  const [url, setUrl] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phones, setPhones] = useState(input.phone.phoneCount);

  useDismissable(onDone);

  useEffect(() => input.onDriverStates(() => setPhones(input.phone.phoneCount)), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const session = await input.phone.openRoom();
        if (cancelled) return;
        setCode(session.code);
        setUrl(session.phoneUrl);
        const dataUrl = await QRCode.toDataURL(session.phoneUrl, {
          margin: 0,
          width: 420,
          color: { dark: '#0d0a10', light: '#ffffff' },
        });
        if (!cancelled) setQr(dataUrl);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('pair.startFail'));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (phones > 0) toast(t('pair.phoneConnectedToast'), 'good');
  }, [phones, toast, t]);

  return (
    <FocusScope name="phonepair">
      <div className="centered">
        <div className="pair">
          <header className="stack stack-xs">
            <p className="t-label">{t('pair.phoneTitle')}</p>
            <h1 className="t-hero">{t('pair.scanToConnect')}</h1>
            <p className="t-body" style={{ maxWidth: '58ch' }}>
              {t('pair.phoneBody')}
            </p>
          </header>

          {!user ? (
            <div className="glass panel">
              <p className="t-body">{t('pair.phoneNeedsAccount')}</p>
            </div>
          ) : error ? (
            <div className="glass panel stack stack-xs" style={{ borderColor: 'rgba(255,125,148,0.4)' }}>
              <p className="t-section">{t('pair.startFail')}</p>
              <p className="t-body">{error}</p>
            </div>
          ) : (
            <div className="glass panel qr">
              <div className="qr__canvas">
                {qr ? <img src={qr} alt={t('pair.scanToConnect')} /> : <div className="skeleton" style={{ width: '100%', height: '100%' }} />}
              </div>
              <div className="stack stack-sm grow">
                <div>
                  <p className="t-label">{t('pair.orOpen')}</p>
                  <p className="t-body" style={{ overflowWrap: 'anywhere' }}>{url ?? '…'}</p>
                </div>
                <div>
                  <p className="t-label">{t('pair.code')}</p>
                  <p className="paircode">{code ?? '••••••••'}</p>
                </div>
                <p className="t-meta">
                  {phones > 0
                    ? t('pair.phonesConnected', { n: phones, s: phones === 1 ? '' : 's' })
                    : t('pair.phoneWaiting')}
                </p>
              </div>
            </div>
          )}

          <div className="dialog__actions">
            <Button variant="primary" priority={10} onSelect={onDone}>
              {t('pair.done')}
            </Button>
          </div>
        </div>
      </div>
    </FocusScope>
  );
}
