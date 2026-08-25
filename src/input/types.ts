import type { RemoteAction, RemoteDriverId, RemoteMapping } from '../../shared/types';

/** One physical button transition, normalised across every driver. */
export interface RawSignal {
  /**
   * Opaque, stable identity for a single physical button, namespaced by
   * driver: `kb:ArrowUp`, `hid:2:04`, `pad:b12`, `ble:2a4d:01`.
   * Opaque is fine because the calibration wizard learns the meaning.
   */
  code: string;
  /** Readable name shown in the wizard, e.g. "Arrow Up" or "Report 2 · 0x04". */
  label: string;
  driver: RemoteDriverId;
  phase: 'down' | 'up';
  /** True for OS-generated auto-repeat, so we can throttle it separately. */
  repeat?: boolean;
  deviceName?: string;
  /** Present for keyboard signals so the manager can suppress page scrolling. */
  native?: Event;
}

export type SignalSink = (signal: RawSignal) => void;

export interface DriverState {
  id: RemoteDriverId;
  label: string;
  blurb: string;
  /** The API exists in this browser. */
  supported: boolean;
  /** Currently delivering signals. */
  connected: boolean;
  /** Requires a click to open the browser's device chooser. */
  needsPermission: boolean;
  deviceName?: string;
  error?: string;
  /** Extra honesty for the pairing screen. */
  caveat?: string;
}

export interface Driver {
  readonly id: RemoteDriverId;
  readonly label: string;
  readonly blurb: string;
  readonly needsPermission: boolean;
  supported(): boolean;
  /** Passive attach — never shows a dialog, safe to run on boot. */
  start(sink: SignalSink, notify: () => void): void | Promise<void>;
  /** Opens the browser device chooser. MUST be called inside a user gesture. */
  connect?(): Promise<void>;
  stop(): void;
  state(): DriverState;
}

export interface ActionEvent {
  action: RemoteAction;
  driver: RemoteDriverId;
  /** True when produced by holding the button rather than a fresh press. */
  repeat: boolean;
  code: string;
}

export type { RemoteAction, RemoteDriverId, RemoteMapping };
