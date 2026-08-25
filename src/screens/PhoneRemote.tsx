import { useCallback, useEffect, useRef, useState } from 'react';
import type { RemoteAction, RemoteSocketMessage } from '../../shared/types';

/**
 * The phone remote.
 *
 * This is the one screen in the product built for touch, and it exists for two
 * reasons: it is a remote that works on any hardware with no pairing at all, and
 * it is the only humane way to type a 30-character WebDAV password.
 *
 * It intentionally does not require an account. The pairing code is the
 * capability — that is what makes "scan the QR and start using it" possible
 * without a password prompt on a phone. The code is 40 bits of entropy, is only
 * joinable for 15 minutes, is refused unless a TV is actively listening, and the
 * room retires itself after 40 join attempts.
 */

type Status = 'connecting' | 'live' | 'closed' | 'error';

export function PhoneRemote({ code }: { code: string }) {
  const socketRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [message, setMessage] = useState<string | null>(null);
  const [tvState, setTvState] = useState<{ title?: string; playing?: boolean; screen?: string }>({});
  const [text, setText] = useState('');
  const retries = useRef(0);

  const connect = useCallback(() => {
    const url = `${location.origin.replace(/^http/, 'ws')}/api/remote/socket?code=${encodeURIComponent(code)}&role=phone`;
    const socket = new WebSocket(url);
    socketRef.current = socket;
    setStatus('connecting');

    socket.addEventListener('open', () => {
      retries.current = 0;
      setStatus('live');
      setMessage(null);
    });

    socket.addEventListener('message', (event) => {
      let msg: RemoteSocketMessage;
      try {
        msg = JSON.parse(String(event.data)) as RemoteSocketMessage;
      } catch {
        return;
      }
      if (msg.t === 'state') setTvState({ title: msg.title, playing: msg.playing, screen: msg.screen });
      if (msg.t === 'peers' && !msg.tv) setMessage('The TV disconnected.');
    });

    socket.addEventListener('close', (event) => {
      setStatus('closed');
      // 1006 with no reason is the usual shape of a rejected upgrade.
      if (event.reason) setMessage(event.reason);
      else if (retries.current === 0) {
        setMessage('That code is not active. Open the pairing screen on your TV and scan again.');
      }
      if (retries.current < 4) {
        retries.current += 1;
        window.setTimeout(connect, 1200 * retries.current);
      }
    });

    socket.addEventListener('error', () => setStatus('error'));
  }, [code]);

  useEffect(() => {
    connect();
    return () => socketRef.current?.close();
  }, [connect]);

  const send = useCallback((msg: RemoteSocketMessage) => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(msg));
    // A short haptic tick makes a glass D-pad feel like a button.
    if ('vibrate' in navigator) navigator.vibrate?.(12);
  }, []);

  const act = useCallback((action: RemoteAction) => send({ t: 'action', action }), [send]);

  // Repeat while held, matching how a real remote's auto-repeat behaves.
  const holdTimer = useRef<number | null>(null);
  const startHold = useCallback(
    (action: RemoteAction) => {
      act(action);
      if (holdTimer.current !== null) clearInterval(holdTimer.current);
      const begin = window.setTimeout(() => {
        holdTimer.current = window.setInterval(() => send({ t: 'action', action, repeat: true }), 120);
      }, 380);
      holdTimer.current = begin;
    },
    [act, send],
  );
  const endHold = useCallback(() => {
    if (holdTimer.current !== null) {
      clearInterval(holdTimer.current);
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  useEffect(() => endHold, [endHold]);

  const dir = (action: RemoteAction, glyph: string, area: string) => (
    <button
      className="phone__dir"
      style={{ gridArea: area }}
      onPointerDown={(e) => {
        e.preventDefault();
        startHold(action);
      }}
      onPointerUp={endHold}
      onPointerLeave={endHold}
      onPointerCancel={endHold}
      aria-label={action}
    >
      {glyph}
    </button>
  );

  return (
    <div className="phone">
      <div className="ambient" aria-hidden="true">
        <div className="ambient__blob ambient__blob--ember" />
        <div className="ambient__vignette" />
      </div>

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 18, flex: 1 }}>
        <header className="ta-center stack stack-xs">
          <p className="t-label">Hearth remote</p>
          <p className="t-section">
            {status === 'live' ? tvState.title ?? 'Connected' : status === 'connecting' ? 'Connecting…' : 'Disconnected'}
          </p>
        </header>

        <div className="phone__status">
          <span
            className="driver__dot"
            style={{ marginTop: 0, background: status === 'live' ? 'var(--sage)' : 'var(--rose)' }}
          />
          <span>
            {status === 'live'
              ? `Code ${code}`
              : message ?? 'Trying to reach the TV…'}
          </span>
        </div>

        {message && status !== 'live' ? (
          <p className="ta-center field__error" style={{ padding: '0 12px' }}>
            {message}
          </p>
        ) : null}

        <div className="phone__pad">
          {dir('up', '▲', '1 / 2')}
          {dir('left', '◀', '2 / 1')}
          <button className="phone__ok" onPointerDown={() => act('select')} aria-label="OK">
            OK
          </button>
          {dir('right', '▶', '2 / 3')}
          {dir('down', '▼', '3 / 2')}
        </div>

        <div className="phone__buttons">
          <button className="phone__btn" onPointerDown={() => act('back')}>
            <strong>↩</strong>
            Back
          </button>
          <button className="phone__btn" onPointerDown={() => act('home')}>
            <strong>⌂</strong>
            Home
          </button>
          <button className="phone__btn" onPointerDown={() => act('menu')}>
            <strong>≡</strong>
            Menu
          </button>
          <button className="phone__btn" onPointerDown={() => act('playpause')}>
            <strong>⏯</strong>
            Play
          </button>
          <button className="phone__btn" onPointerDown={() => act('prev')}>
            <strong>⏮</strong>
            Prev
          </button>
          <button className="phone__btn" onPointerDown={() => act('rewind')}>
            <strong>⏪</strong>
            Back 60
          </button>
          <button className="phone__btn" onPointerDown={() => act('forward')}>
            <strong>⏩</strong>
            Fwd 60
          </button>
          <button className="phone__btn" onPointerDown={() => act('next')}>
            <strong>⏭</strong>
            Next
          </button>
        </div>

        <form
          className="phone__typing"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text) return;
            send({ t: 'text', value: text });
            setText('');
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type into the TV…"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="send"
          />
          <button className="btn btn--primary" type="submit">
            Send
          </button>
        </form>

        <p className="t-meta ta-center">
          Hold a direction to repeat. Text goes straight into whatever field the TV has open.
        </p>
      </div>
    </div>
  );
}
