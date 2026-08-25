import type { RemoteSocketMessage } from '../../../shared/types';
import type { Driver, DriverState, SignalSink } from '../types';

/**
 * Phone-as-remote driver.
 *
 * The TV opens a WebSocket to a Durable Object room keyed by a short pairing
 * code; the phone loads `/remote/<code>` and joins the same room. This is the
 * fallback that always works, on any hardware, with no drivers and no pairing
 * dialogs — and it doubles as the text-entry method, since typing a WebDAV
 * password on a D-pad is miserable.
 */
export class PhoneDriver implements Driver {
  readonly id = 'phone' as const;
  readonly label = 'Your phone';
  readonly blurb = 'Scan a code and your phone becomes the remote. Works everywhere, no pairing.';
  readonly needsPermission = false;

  private sink: SignalSink | null = null;
  private notify: (() => void) | null = null;
  private socket: WebSocket | null = null;
  private code: string | null = null;
  private phones = 0;
  private lastError?: string;
  private reconnectTimer: number | null = null;
  private closedByUs = false;
  private textListeners = new Set<(value: string) => void>();

  supported(): boolean {
    return typeof WebSocket !== 'undefined';
  }

  start(sink: SignalSink, notify: () => void): void {
    this.sink = sink;
    this.notify = notify;
  }

  /** Asks the server for a fresh code and joins the room as the TV. */
  async openRoom(): Promise<{ code: string; phoneUrl: string }> {
    const res = await fetch('/api/remote/session', { method: 'POST', credentials: 'same-origin' });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? 'Could not start a pairing session.');
    }
    const data = (await res.json()) as { code: string; phoneUrl: string; socketUrl: string };
    this.code = data.code;
    this.closedByUs = false;
    this.attach(data.socketUrl);
    return { code: data.code, phoneUrl: data.phoneUrl };
  }

  private attach(url: string): void {
    this.socket?.close();
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.lastError = undefined;
      this.notify?.();
    });

    socket.addEventListener('message', (event) => {
      let msg: RemoteSocketMessage;
      try {
        msg = JSON.parse(String(event.data)) as RemoteSocketMessage;
      } catch {
        return;
      }

      if (msg.t === 'peers') {
        this.phones = msg.phones;
        this.notify?.();
        return;
      }

      if (msg.t === 'text') {
        for (const fn of this.textListeners) fn(msg.value);
        return;
      }

      if (msg.t === 'action' && this.sink) {
        // Phone signals are already actions; emit a matched down/up pair so
        // hold-to-repeat and long-press behave the same as on real hardware.
        const code = `phone:${msg.action}`;
        this.sink({
          code,
          label: msg.action,
          driver: this.id,
          phase: 'down',
          repeat: msg.repeat === true,
        });
        this.sink({ code, label: msg.action, driver: this.id, phase: 'up' });
      }
    });

    socket.addEventListener('close', () => {
      this.socket = null;
      this.phones = 0;
      this.notify?.();
      // Reconnect unless we deliberately tore the room down.
      if (!this.closedByUs && this.code) {
        this.reconnectTimer = window.setTimeout(() => {
          if (!this.code || this.closedByUs) return;
          const origin = location.origin.replace(/^http/, 'ws');
          this.attach(`${origin}/api/remote/socket?code=${this.code}&role=tv`);
        }, 2500);
      }
    });

    socket.addEventListener('error', () => {
      this.lastError = 'Lost the connection to the pairing room.';
      this.notify?.();
    });
  }

  /** Mirrors what is on screen to the phone, so it can show a Now Playing bar. */
  sendState(state: { title?: string; playing?: boolean; screen?: string }): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    const msg: RemoteSocketMessage = { t: 'state', ...state };
    this.socket.send(JSON.stringify(msg));
  }

  /** Text typed on the phone keyboard, routed into the focused field. */
  onText(fn: (value: string) => void): () => void {
    this.textListeners.add(fn);
    return () => this.textListeners.delete(fn);
  }

  get pairingCode(): string | null {
    return this.code;
  }

  get phoneCount(): number {
    return this.phones;
  }

  stop(): void {
    this.closedByUs = true;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
    this.code = null;
    this.phones = 0;
    this.sink = null;
  }

  state(): DriverState {
    return {
      id: this.id,
      label: this.label,
      blurb: this.blurb,
      supported: this.supported(),
      connected: this.phones > 0,
      needsPermission: false,
      deviceName: this.phones > 0 ? `${this.phones} phone${this.phones === 1 ? '' : 's'}` : undefined,
      error: this.lastError,
      caveat: this.socket ? undefined : 'Open the pairing screen to get a code.',
    };
  }
}
