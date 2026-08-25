import type { Driver, DriverState, SignalSink } from '../types';

const AXIS_THRESHOLD = 0.55;
/** Below this, a stick is considered centred again (hysteresis). */
const AXIS_RELEASE = 0.35;

/**
 * Gamepad driver.
 *
 * Many BLE "air mouse" remotes and every game controller expose themselves
 * through the Gamepad API. There is no permission prompt, but the browser only
 * reveals the pad after the first button press, so this polls continuously and
 * reports connection state as it discovers devices.
 */
export class GamepadDriver implements Driver {
  readonly id = 'gamepad' as const;
  readonly label = 'Game controller or air mouse';
  readonly blurb =
    'Anything that shows up as a gamepad: a controller, or one of the many BLE remotes that pretend to be one.';
  readonly needsPermission = false;

  private sink: SignalSink | null = null;
  private notify: (() => void) | null = null;
  private raf: number | null = null;
  private pressed = new Set<string>();
  private names = new Set<string>();

  supported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function';
  }

  start(sink: SignalSink, notify: () => void): void {
    if (!this.supported()) return;
    this.sink = sink;
    this.notify = notify;
    window.addEventListener('gamepadconnected', this.onChange);
    window.addEventListener('gamepaddisconnected', this.onChange);
    this.loop();
  }

  stop(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    window.removeEventListener('gamepadconnected', this.onChange);
    window.removeEventListener('gamepaddisconnected', this.onChange);
    this.pressed.clear();
    this.names.clear();
    this.sink = null;
  }

  private onChange = (): void => {
    this.refreshNames();
    this.notify?.();
  };

  private refreshNames(): void {
    this.names.clear();
    for (const pad of navigator.getGamepads()) {
      if (pad) this.names.add(pad.id.replace(/\s*\([^)]*\)\s*/g, '').trim() || pad.id);
    }
  }

  /**
   * Polling is the only way to read a gamepad. Doing it on rAF keeps it in step
   * with rendering and costs nothing measurable.
   */
  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.sink) return;

    const pads = navigator.getGamepads();
    const live = new Set<string>();

    for (const pad of pads) {
      if (!pad) continue;
      const name = pad.id.replace(/\s*\([^)]*\)\s*/g, '').trim() || pad.id;
      if (!this.names.has(name)) {
        this.names.add(name);
        this.notify?.();
      }

      pad.buttons.forEach((button, index) => {
        if (!button.pressed && button.value < 0.5) return;
        const code = `pad:b${index}`;
        live.add(code);
        this.emit(code, `Button ${index}`, name);
      });

      pad.axes.forEach((value, index) => {
        if (Math.abs(value) < AXIS_RELEASE) return;
        if (Math.abs(value) < AXIS_THRESHOLD && !this.pressed.has(`pad:a${index}${value > 0 ? '+' : '-'}`)) {
          return;
        }
        const code = `pad:a${index}${value > 0 ? '+' : '-'}`;
        live.add(code);
        this.emit(code, `Axis ${index} ${value > 0 ? 'positive' : 'negative'}`, name);
      });
    }

    // Anything that was held last frame but is absent now has been released.
    for (const code of [...this.pressed]) {
      if (live.has(code)) continue;
      this.pressed.delete(code);
      this.sink({ code, label: code, driver: this.id, phase: 'up' });
    }
  };

  private emit(code: string, label: string, deviceName: string): void {
    const repeat = this.pressed.has(code);
    this.pressed.add(code);
    // Repeat pacing is the manager's job; every held frame is reported so it
    // can decide, rather than each driver inventing its own timing.
    this.sink?.({ code, label, driver: this.id, phase: 'down', repeat, deviceName });
  }

  state(): DriverState {
    const supported = this.supported();
    return {
      id: this.id,
      label: this.label,
      blurb: this.blurb,
      supported,
      connected: this.names.size > 0,
      needsPermission: false,
      deviceName: [...this.names].join(', ') || undefined,
      caveat: supported ? 'Press any button once so the browser reveals the device.' : undefined,
    };
  }
}
