import type { Driver, DriverState, SignalSink } from '../types';

/** Nordic UART Service — what almost every DIY nRF/ESP32 BLE remote uses. */
const NORDIC_UART = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const BATTERY = 'battery_service';

const EXTRA_UUID_KEY = 'hearth.ble.serviceUuid';

/**
 * Web Bluetooth driver — for custom BLE remotes only.
 *
 * ## Read this before expecting it to work with a normal remote
 *
 * A Bluetooth remote control is a HID device: it speaks the GATT HID-over-GATT
 * service, UUID 0x1812. That UUID is on Chrome's GATT blocklist and always will
 * be, because handing a web page raw HID reports would make every website a
 * keylogger. `requestDevice` throws a SecurityError if you even name it.
 *
 * So this driver cannot drive an Apple TV Siri Remote, an Android TV remote or
 * a generic BLE air mouse — not because of a missing feature, but by design.
 * Those remotes are handled by pairing them to the operating system, where they
 * arrive as key events (see the keyboard driver).
 *
 * What this driver *is* good for: a remote you built or flashed yourself that
 * exposes a custom GATT service, which is not blocklisted.
 */
export class BluetoothDriver implements Driver {
  readonly id = 'bluetooth' as const;
  readonly label = 'Custom BLE device';
  readonly blurb =
    'Connects to a BLE remote that exposes a custom GATT service — typically one you built yourself.';
  readonly needsPermission = true;

  private sink: SignalSink | null = null;
  private notify: (() => void) | null = null;
  private device: BluetoothDevice | null = null;
  private characteristics: BluetoothRemoteGATTCharacteristic[] = [];
  private available = false;
  private lastError?: string;

  supported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
  }

  async start(sink: SignalSink, notify: () => void): Promise<void> {
    this.sink = sink;
    this.notify = notify;
    if (!navigator.bluetooth) return;
    try {
      this.available = await navigator.bluetooth.getAvailability();
    } catch {
      this.available = false;
    }
    notify();
  }

  /** The extra service UUID the user pasted in, if any. */
  static customUuid(): string {
    try {
      return localStorage.getItem(EXTRA_UUID_KEY) ?? '';
    } catch {
      return '';
    }
  }

  static setCustomUuid(uuid: string): void {
    try {
      if (uuid) localStorage.setItem(EXTRA_UUID_KEY, uuid.trim().toLowerCase());
      else localStorage.removeItem(EXTRA_UUID_KEY);
    } catch {
      /* private browsing */
    }
  }

  async connect(): Promise<void> {
    if (!navigator.bluetooth) throw new Error('This browser does not support Web Bluetooth.');
    this.lastError = undefined;

    const custom = BluetoothDriver.customUuid();
    const services: (string | number)[] = [NORDIC_UART, BATTERY];
    if (custom && custom !== NORDIC_UART) services.unshift(custom);

    try {
      this.device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: services,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/cancel|User cancelled/i.test(msg)) return;
      if (/blocklist/i.test(msg)) {
        throw new Error(
          'That service is blocked by the browser. Bluetooth HID remotes can never be read from a web page — pair the remote in your computer’s Bluetooth settings instead, then use “Remote via system pairing”.',
        );
      }
      throw e;
    }

    if (!this.device.gatt) throw new Error('That device does not expose GATT services.');

    this.device.addEventListener('gattserverdisconnected', this.onDisconnect);
    const server = await this.device.gatt.connect();

    // Only services named in `optionalServices` are visible; blind discovery
    // is not permitted by the spec.
    let discovered: BluetoothRemoteGATTService[] = [];
    try {
      discovered = await server.getPrimaryServices();
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
    }

    for (const service of discovered) {
      let chars: BluetoothRemoteGATTCharacteristic[] = [];
      try {
        chars = await service.getCharacteristics();
      } catch {
        continue;
      }
      for (const ch of chars) {
        if (!ch.properties.notify && !ch.properties.indicate) continue;
        try {
          await ch.startNotifications();
          ch.addEventListener('characteristicvaluechanged', this.onValue);
          this.characteristics.push(ch);
        } catch {
          /* some characteristics refuse subscription */
        }
      }
    }

    if (!this.characteristics.length) {
      throw new Error(
        `Connected to “${this.device.name ?? 'device'}”, but it exposes no readable button service. ` +
          'If you know its GATT service UUID, enter it above and try again. A stock Bluetooth remote will never work here — use system pairing.',
      );
    }

    this.notify?.();
  }

  private onValue = (event: Event): void => {
    const ch = event.target as BluetoothRemoteGATTCharacteristic;
    const view = ch.value;
    if (!view || !this.sink) return;

    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    if (bytes.every((b) => b === 0)) return; // release frame

    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    const short = ch.uuid.slice(0, 8);
    this.sink({
      code: `ble:${short}:${hex}`,
      label: `${short} · 0x${hex}`,
      driver: this.id,
      phase: 'down',
      deviceName: this.device?.name,
    });
    // Custom devices rarely send an explicit release, so synthesise one.
    setTimeout(() => {
      this.sink?.({
        code: `ble:${short}:${hex}`,
        label: `${short} · 0x${hex}`,
        driver: this.id,
        phase: 'up',
      });
    }, 60);
  };

  private onDisconnect = (): void => {
    this.characteristics = [];
    this.notify?.();
  };

  stop(): void {
    for (const ch of this.characteristics) {
      ch.removeEventListener('characteristicvaluechanged', this.onValue);
      void ch.stopNotifications().catch(() => undefined);
    }
    this.characteristics = [];
    this.device?.removeEventListener('gattserverdisconnected', this.onDisconnect);
    this.device?.gatt?.disconnect();
    this.device = null;
    this.sink = null;
  }

  state(): DriverState {
    const supported = this.supported();
    return {
      id: this.id,
      label: this.label,
      blurb: this.blurb,
      supported,
      connected: this.characteristics.length > 0,
      needsPermission: true,
      deviceName: this.device?.name,
      error: this.lastError,
      caveat: !supported
        ? 'Web Bluetooth needs Chrome, Edge or Opera. Safari and Firefox do not implement it.'
        : this.available
          ? 'Standard Bluetooth remotes are HID devices, which browsers permanently block. Use system pairing for those.'
          : 'No Bluetooth adapter is available on this computer.',
    };
  }
}
