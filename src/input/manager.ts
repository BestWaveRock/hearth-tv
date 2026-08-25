import type { RemoteAction, RemoteDriverId, RemoteMapping } from '../../shared/types';
import { DEFAULT_MAPPING } from './defaults';
import { BluetoothDriver } from './drivers/bluetooth';
import { GamepadDriver } from './drivers/gamepad';
import { KeyboardDriver } from './drivers/keyboard';
import { PhoneDriver } from './drivers/phone';
import { WebHidDriver } from './drivers/webhid';
import type { ActionEvent, Driver, DriverState, RawSignal } from './types';

/** Actions that make sense to fire repeatedly while a button is held. */
const REPEATABLE = new Set<RemoteAction>([
  'up', 'down', 'left', 'right', 'volumeUp', 'volumeDown', 'rewind', 'forward',
]);

const HOLD_DELAY_MS = 360;
const REPEAT_MIN_MS = 70;
const REPEAT_START_MS = 130;
const LONG_PRESS_MS = 700;

const LOCAL_MAPPING_KEY = 'hearth.remote.mapping';
const LOCAL_DRIVER_KEY = 'hearth.remote.driver';

interface HoldRecord {
  action: RemoteAction;
  firstAt: number;
  lastEmit: number;
  focusAtPress: string | null;
  longPressTimer: number | null;
}

/**
 * Turns raw hardware signals into TV actions.
 *
 * Responsibilities that genuinely belong in one place:
 *  - own every driver, so the pairing screen can show one honest status list;
 *  - resolve signal -> action through the merged mapping;
 *  - pace auto-repeat, with acceleration, so holding a direction feels right;
 *  - stop the browser scrolling the page when a mapped key is pressed;
 *  - track idleness, which is what the screensaver waits on.
 */
export class InputManager {
  readonly keyboard = new KeyboardDriver();
  readonly webhid = new WebHidDriver();
  readonly gamepad = new GamepadDriver();
  readonly bluetooth = new BluetoothDriver();
  readonly phone = new PhoneDriver();

  readonly drivers: Driver[];

  private mapping: RemoteMapping = { ...DEFAULT_MAPPING };
  private actionListeners = new Set<(e: ActionEvent) => void>();
  private stateListeners = new Set<(states: DriverState[]) => void>();
  private signalListeners = new Set<(s: RawSignal) => void>();
  private captureHandler: ((s: RawSignal) => void) | null = null;
  private holds = new Map<string, HoldRecord>();
  private started = false;
  private lastActivityAt = Date.now();
  private activityListeners = new Set<() => void>();

  /** Injected by the app: is a long press meaningful on the focused element? */
  private longPressProbe: () => boolean = () => false;
  /** Injected by the app: what has focus right now (to detect navigation). */
  private focusProbe: () => string | null = () => null;

  constructor() {
    this.drivers = [this.keyboard, this.phone, this.webhid, this.gamepad, this.bluetooth];
    this.mapping = { ...DEFAULT_MAPPING, ...this.loadLocalMapping() };
  }

  /* ----------------------------- lifecycle ----------------------------- */

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    const notify = () => this.emitStates();
    // Keyboard and gamepad attach passively — no prompts, so they are safe
    // to start before the user has agreed to anything.
    this.keyboard.start(this.onSignal, notify);
    this.gamepad.start(this.onSignal, notify);
    this.phone.start(this.onSignal, notify);
    if (this.webhid.supported()) await this.webhid.start(this.onSignal, notify);
    if (this.bluetooth.supported()) await this.bluetooth.start(this.onSignal, notify);
    this.emitStates();
  }

  stop(): void {
    for (const d of this.drivers) d.stop();
    this.started = false;
  }

  setProbes(probes: { longPress?: () => boolean; focus?: () => string | null }): void {
    if (probes.longPress) this.longPressProbe = probes.longPress;
    if (probes.focus) this.focusProbe = probes.focus;
  }

  /* ------------------------------ mapping ------------------------------ */

  getMapping(): RemoteMapping {
    return { ...this.mapping };
  }

  /** User overrides layered on top of the built-in defaults. */
  setMapping(overrides: RemoteMapping, persist = true): void {
    this.mapping = { ...DEFAULT_MAPPING, ...overrides };
    if (persist) {
      try {
        localStorage.setItem(LOCAL_MAPPING_KEY, JSON.stringify(overrides));
      } catch {
        /* private browsing */
      }
    }
    this.emitStates();
  }

  private loadLocalMapping(): RemoteMapping {
    try {
      const raw = localStorage.getItem(LOCAL_MAPPING_KEY);
      return raw ? (JSON.parse(raw) as RemoteMapping) : {};
    } catch {
      return {};
    }
  }

  loadLocalOverrides(): RemoteMapping {
    return this.loadLocalMapping();
  }

  /** Remembers which driver the user paired with, to greet them correctly. */
  rememberDriver(id: RemoteDriverId): void {
    try {
      localStorage.setItem(LOCAL_DRIVER_KEY, id);
    } catch {
      /* ignore */
    }
  }

  rememberedDriver(): RemoteDriverId | null {
    try {
      return localStorage.getItem(LOCAL_DRIVER_KEY) as RemoteDriverId | null;
    } catch {
      return null;
    }
  }

  /* --------------------------- subscriptions --------------------------- */

  onAction(fn: (e: ActionEvent) => void): () => void {
    this.actionListeners.add(fn);
    return () => this.actionListeners.delete(fn);
  }

  onDriverStates(fn: (states: DriverState[]) => void): () => void {
    this.stateListeners.add(fn);
    fn(this.states());
    return () => this.stateListeners.delete(fn);
  }

  /** Every raw signal, for the diagnostics panel. */
  onSignalSeen(fn: (s: RawSignal) => void): () => void {
    this.signalListeners.add(fn);
    return () => this.signalListeners.delete(fn);
  }

  onActivity(fn: () => void): () => void {
    this.activityListeners.add(fn);
    return () => this.activityListeners.delete(fn);
  }

  states(): DriverState[] {
    return this.drivers.map((d) => d.state());
  }

  private emitStates(): void {
    const states = this.states();
    for (const fn of this.stateListeners) fn(states);
  }

  /** True once any driver has produced a usable signal. */
  get anyConnected(): boolean {
    return this.states().some((s) => s.connected);
  }

  idleMs(): number {
    return Date.now() - this.lastActivityAt;
  }

  noteActivity(): void {
    this.lastActivityAt = Date.now();
    for (const fn of this.activityListeners) fn();
  }

  /* --------------------------- calibration ----------------------------- */

  /**
   * Captures the next physical button press instead of acting on it.
   * Returns a cancel function.
   */
  captureNextSignal(fn: (s: RawSignal) => void): () => void {
    this.captureHandler = fn;
    return () => {
      if (this.captureHandler === fn) this.captureHandler = null;
    };
  }

  get isCapturing(): boolean {
    return this.captureHandler !== null;
  }

  /* ----------------------------- dispatch ------------------------------ */

  /** Lets the on-screen UI synthesise an action (e.g. an on-screen D-pad). */
  dispatch(action: RemoteAction, driver: RemoteDriverId = 'phone'): void {
    this.noteActivity();
    const event: ActionEvent = { action, driver, repeat: false, code: `virtual:${action}` };
    for (const fn of this.actionListeners) fn(event);
  }

  private onSignal = (signal: RawSignal): void => {
    for (const fn of this.signalListeners) fn(signal);

    // Calibration swallows presses so the UI behind it cannot move.
    if (this.captureHandler) {
      if (signal.phase === 'down' && !signal.repeat) {
        this.suppress(signal);
        this.noteActivity();
        this.captureHandler(signal);
      } else if (signal.phase === 'down') {
        this.suppress(signal);
      }
      return;
    }

    const action = this.mapping[signal.code];
    if (!action) return;

    // Never steal a keypress that a real text field needs. The decision is made
    // on the *physical key*, not the mapped action: Backspace maps to `back`,
    // but inside a text field it has to delete a character instead of
    // navigating away.
    if (signal.driver === 'keyboard' && isEditing()) {
      const bare = signal.code.slice(3);
      if (TEXT_EDIT_CODES.has(bare) || isPrintableKey(bare)) return;
      if (!EDIT_SAFE.has(action)) return;
    }

    this.suppress(signal);

    if (signal.phase === 'up') {
      this.release(signal.code);
      return;
    }

    this.noteActivity();

    const now = Date.now();
    const existing = this.holds.get(signal.code);

    if (!existing || !signal.repeat) {
      this.release(signal.code);
      const record: HoldRecord = {
        action,
        firstAt: now,
        lastEmit: now,
        focusAtPress: this.focusProbe(),
        longPressTimer: null,
      };

      if (action === 'select') {
        // Long press is additive: `select` has already fired, so the handler
        // only runs if it did not navigate away.
        record.longPressTimer = window.setTimeout(() => {
          const stillHeld = this.holds.get(signal.code) === record;
          if (!stillHeld) return;
          if (this.focusProbe() !== record.focusAtPress) return;
          if (!this.longPressProbe()) return;
          this.emit({ action: 'menu', driver: signal.driver, repeat: false, code: signal.code });
        }, LONG_PRESS_MS);
      }

      this.holds.set(signal.code, record);
      this.emit({ action, driver: signal.driver, repeat: false, code: signal.code });
      return;
    }

    // Held down. Only directional-style actions repeat.
    if (!REPEATABLE.has(action)) return;
    if (now - existing.firstAt < HOLD_DELAY_MS) return;

    // Accelerate: 130ms between steps, tightening to 70ms after a few seconds.
    const heldFor = now - existing.firstAt - HOLD_DELAY_MS;
    const interval = Math.max(REPEAT_MIN_MS, REPEAT_START_MS - Math.floor(heldFor / 700) * 15);
    if (now - existing.lastEmit < interval) return;

    existing.lastEmit = now;
    this.emit({ action, driver: signal.driver, repeat: true, code: signal.code });
  };

  private release(code: string): void {
    const record = this.holds.get(code);
    if (!record) return;
    if (record.longPressTimer !== null) clearTimeout(record.longPressTimer);
    this.holds.delete(code);
  }

  private emit(event: ActionEvent): void {
    for (const fn of this.actionListeners) fn(event);
  }

  /**
   * Stops the browser doing its own thing with a mapped key: arrows scroll the
   * page, Space scrolls too, and Backspace can navigate back in history.
   */
  private suppress(signal: RawSignal): void {
    const native = signal.native;
    if (!native || !native.cancelable) return;
    native.preventDefault();
    native.stopPropagation();
  }
}

/** Actions still delivered while a text field has focus. */
const EDIT_SAFE = new Set<RemoteAction>([
  'up', 'down', 'select', 'back', 'playpause', 'volumeUp', 'volumeDown', 'mute', 'menu', 'home',
]);

/**
 * Physical keys a focused text field owns outright. `Space` is here because it
 * maps to `select`, and a space bar must type a space when you are typing.
 */
const TEXT_EDIT_CODES = new Set([
  'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Space', 'Tab',
]);

/** `KeyA`, `Digit4`, `Minus`, `Period`… — anything that produces a character. */
function isPrintableKey(code: string): boolean {
  return (
    /^Key[A-Z]$/.test(code) ||
    /^Digit\d$/.test(code) ||
    /^Numpad/.test(code) ||
    [
      'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon',
      'Quote', 'Comma', 'Period', 'Slash', 'Backquote',
    ].includes(code)
  );
}

function isEditing(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return (el as HTMLElement).isContentEditable === true;
}

/** One manager for the whole app; drivers hold OS-level resources. */
export const input = new InputManager();
