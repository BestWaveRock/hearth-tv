import type { Driver, DriverState, SignalSink } from '../types';

/**
 * WebHID driver.
 *
 * This reads a remote's raw HID input reports directly, which is useful for
 * remotes whose buttons the operating system swallows instead of forwarding as
 * key events (dedicated media keys, vendor-specific buttons).
 *
 * Two hard limits, both enforced by Chrome and neither of them bugs:
 *  - A device that exposes a top-level keyboard collection is blocked outright,
 *    because granting a web page raw keyboard reports would be a keylogger.
 *  - Consumer Control (usage page 0x0C) *is* allowed, which is where most TV
 *    remote buttons live.
 *
 * Signals are emitted as opaque `hid:<reportId>:<hex>` codes and given meaning
 * by the calibration wizard, so no per-vendor decoding table is needed.
 */
export class WebHidDriver implements Driver {
  readonly id = 'webhid' as const;
  readonly label = 'WebHID device';
  readonly blurb =
    'Reads a remote’s raw button reports. Best for remotes whose media keys the operating system keeps to itself.';
  readonly needsPermission = true;

  private sink: SignalSink | null = null;
  private notify: (() => void) | null = null;
  private devices: HIDDevice[] = [];
  private lastError?: string;
  /** Last non-zero payload per report id, used to detect release. */
  private lastPayload = new Map<number, string>();
  /**
   * Report ids that belong to a Consumer Control collection, per device.
   * Reports from those can be decoded into standard HID usages instead of being
   * treated as opaque bytes, which is what lets a TV remote's Back and
   * Play/Pause buttons work with no calibration at all.
   */
  private consumerReports = new WeakMap<HIDDevice, Set<number>>();

  supported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.hid;
  }

  async start(sink: SignalSink, notify: () => void): Promise<void> {
    this.sink = sink;
    this.notify = notify;
    if (!navigator.hid) return;

    // Devices already granted in a previous session reconnect silently.
    try {
      const granted = await navigator.hid.getDevices();
      for (const device of granted) await this.attach(device);
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
    }
    notify();
  }

  async connect(): Promise<void> {
    if (!navigator.hid) throw new Error('This browser does not support WebHID.');
    this.lastError = undefined;

    let picked: HIDDevice[];
    try {
      picked = await navigator.hid.requestDevice({
        filters: [
          { usagePage: 0x0c }, // Consumer Control — TV remote buttons
          { usagePage: 0x01, usage: 0x80 }, // System Control — power/sleep
          { usagePage: 0xffbc }, // Common vendor page on media remotes
        ],
      });
    } catch (e) {
      // A user dismissing the chooser throws; that is not an error worth showing.
      const msg = e instanceof Error ? e.message : String(e);
      if (/cancel|no device selected/i.test(msg)) return;
      throw e;
    }

    if (!picked.length) {
      throw new Error(
        'No device was selected. Note that Chrome hides remotes that present themselves as a keyboard — for those, use system pairing instead.',
      );
    }
    for (const device of picked) await this.attach(device);
    this.notify?.();
  }

  private async attach(device: HIDDevice): Promise<void> {
    if (this.devices.includes(device)) return;
    try {
      if (!device.opened) await device.open();
    } catch (e) {
      this.lastError = `Could not open ${device.productName || 'device'}: ${
        e instanceof Error ? e.message : String(e)
      }`;
      return;
    }
    this.consumerReports.set(device, findConsumerReports(device));
    device.addEventListener('inputreport', this.onReport);
    this.devices.push(device);
  }

  private onReport = (event: HIDInputReportEvent): void => {
    if (!this.sink) return;

    const bytes = new Uint8Array(
      event.data.buffer,
      event.data.byteOffset,
      event.data.byteLength,
    );
    const allZero = bytes.every((b) => b === 0);
    const previous = this.lastPayload.get(event.reportId);

    if (allZero) {
      // An all-zero report is "button released". Emit the release against the
      // code we last saw so hold-to-repeat and long-press work.
      if (previous) {
        this.lastPayload.delete(event.reportId);
        this.sink({
          code: previous,
          label: previous,
          driver: this.id,
          phase: 'up',
          deviceName: event.device.productName,
        });
      }
      return;
    }

    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

    /**
     * Decode Consumer Control reports into standard HID usages.
     *
     * A TV remote's Back, Home and Play buttons are Consumer Control usages, and
     * those are defined by the HID spec — so they can be understood rather than
     * merely memorised. This is what makes a stock remote work through WebHID
     * without the calibration wizard, and it is also the fallback for buttons
     * macOS keeps to itself and never delivers as key events.
     */
    const isConsumer = this.consumerReports.get(event.device)?.has(event.reportId) ?? false;
    let code: string;
    let label: string;

    if (isConsumer) {
      // Usages are little-endian, and are 1 or 2 bytes depending on the report.
      const usage = bytes.length >= 2 ? bytes[0] | (bytes[1] << 8) : bytes[0];
      code = `hid:consumer:0x${usage.toString(16)}`;
      label = `${CONSUMER_NAMES[usage] ?? 'Consumer'} (0x${usage.toString(16)})`;
    } else {
      code = `hid:${event.reportId}:${hex}`;
      label = `Report ${event.reportId} · 0x${hex}`;
    }

    const repeat = previous === code;
    this.lastPayload.set(event.reportId, code);

    this.sink({
      code,
      label,
      driver: this.id,
      phase: 'down',
      repeat,
      deviceName: event.device.productName,
    });
  };

  stop(): void {
    for (const device of this.devices) {
      device.removeEventListener('inputreport', this.onReport);
      void device.close().catch(() => undefined);
    }
    this.devices = [];
    this.lastPayload.clear();
    this.sink = null;
  }

  state(): DriverState {
    const supported = this.supported();
    return {
      id: this.id,
      label: this.label,
      blurb: this.blurb,
      supported,
      connected: this.devices.length > 0,
      needsPermission: true,
      deviceName: this.devices.map((d) => d.productName).filter(Boolean).join(', ') || undefined,
      error: this.lastError,
      caveat: supported
        ? 'Chrome will not list remotes that identify as a keyboard. Those work through system pairing instead.'
        : 'WebHID needs Chrome, Edge or another Chromium browser.',
    };
  }
}

/** HID usage page 0x0C — Consumer Control. */
const CONSUMER_PAGE = 0x0c;

/**
 * Walks a device's report descriptor to find which report ids carry Consumer
 * Control usages. Collections nest arbitrarily, so this recurses.
 */
function findConsumerReports(device: HIDDevice): Set<number> {
  const ids = new Set<number>();

  const visit = (collection: HIDCollectionInfo): void => {
    const isConsumer = collection.usagePage === CONSUMER_PAGE;
    for (const report of collection.inputReports ?? []) {
      const itemsAreConsumer = (report.items ?? []).some(
        (item) => item.usagePage === CONSUMER_PAGE,
      );
      if (isConsumer || itemsAreConsumer) ids.add(report.reportId);
    }
    for (const child of collection.children ?? []) visit(child);
  };

  for (const collection of device.collections ?? []) visit(collection);
  return ids;
}

/** Readable names for the usages a remote actually sends. */
const CONSUMER_NAMES: Record<number, string> = {
  0x0040: 'Menu',
  0x0041: 'Menu Pick',
  0x0042: 'Menu Up',
  0x0043: 'Menu Down',
  0x0044: 'Menu Left',
  0x0045: 'Menu Right',
  0x0046: 'Menu Escape',
  0x00b0: 'Play',
  0x00b1: 'Pause',
  0x00b3: 'Fast Forward',
  0x00b4: 'Rewind',
  0x00b5: 'Next Track',
  0x00b6: 'Previous Track',
  0x00b7: 'Stop',
  0x00cd: 'Play/Pause',
  0x00e2: 'Mute',
  0x00e9: 'Volume Up',
  0x00ea: 'Volume Down',
  0x0221: 'Search',
  0x0223: 'Home',
  0x0224: 'Back',
  0x0225: 'Forward',
  0x0226: 'Stop',
  0x0227: 'Refresh',
  0x0279: 'Redo',
  0x0289: 'Reply',
};
