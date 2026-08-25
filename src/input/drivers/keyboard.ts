import type { Driver, DriverState, RawSignal, SignalSink } from '../types';
import { prettyKeyLabel } from '../defaults';

/**
 * The keyboard driver — the one that actually works with real remotes today.
 *
 * A Bluetooth TV remote, air mouse or media remote pairs with the operating
 * system as a HID keyboard. The OS decodes it and hands the browser ordinary
 * `keydown` events, so listening for keys *is* listening for the remote. No
 * permission prompt, no blocklist, and it works identically on macOS, Windows,
 * Linux and ChromeOS.
 */
export class KeyboardDriver implements Driver {
  readonly id = 'keyboard' as const;
  readonly label = 'Remote via system pairing';
  readonly blurb =
    'Your remote is paired to this computer in its Bluetooth settings. The browser reads its D-pad directly.';
  readonly needsPermission = false;

  private sink: SignalSink | null = null;
  private notify: (() => void) | null = null;
  private sawInput = false;
  private lastDevice = 'System keyboard / remote';
  /** Codes currently held, so auto-repeat can be told apart from a new press. */
  private held = new Set<string>();

  supported(): boolean {
    return typeof window !== 'undefined';
  }

  start(sink: SignalSink, notify: () => void): void {
    this.sink = sink;
    this.notify = notify;
    window.addEventListener('keydown', this.onKeyDown, { capture: true });
    window.addEventListener('keyup', this.onKeyUp, { capture: true });
  }

  stop(): void {
    window.removeEventListener('keydown', this.onKeyDown, { capture: true });
    window.removeEventListener('keyup', this.onKeyUp, { capture: true });
    this.held.clear();
    this.sink = null;
  }

  state(): DriverState {
    return {
      id: this.id,
      label: this.label,
      blurb: this.blurb,
      supported: true,
      // "Connected" deliberately means *we have actually received a press*.
      // Claiming a connection just because the API exists would make the
      // pairing screen a lie, and would let a broken remote through the gate.
      connected: this.sawInput,
      needsPermission: false,
      deviceName: this.sawInput ? this.lastDevice : undefined,
      caveat: this.sawInput
        ? undefined
        : 'Pair the remote in this computer’s Bluetooth settings, then press any button on it.',
    };
  }

  /**
   * `event.code` is the physical key and is stable across layouts, but it is
   * empty for media keys, where only `event.key` carries the name. Prefer code,
   * fall back to key.
   */
  private codeFor(e: KeyboardEvent): string {
    const raw = e.code && e.code !== 'Unidentified' ? e.code : e.key;
    return `kb:${raw}`;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.sink) return;
    // A modifier chord is a person using a keyboard, not a remote press.
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const code = this.codeFor(e);
    const repeat = e.repeat || this.held.has(code);
    this.held.add(code);

    if (!this.sawInput) {
      this.sawInput = true;
      this.notify?.();
    }

    const signal: RawSignal = {
      code,
      label: prettyKeyLabel(code),
      driver: this.id,
      phase: 'down',
      repeat,
      deviceName: this.lastDevice,
      native: e,
    };
    this.sink(signal);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (!this.sink) return;
    const code = this.codeFor(e);
    this.held.delete(code);
    this.sink({
      code,
      label: prettyKeyLabel(code),
      driver: this.id,
      phase: 'up',
      deviceName: this.lastDevice,
      native: e,
    });
  };
}
