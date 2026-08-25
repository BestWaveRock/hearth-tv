import { useApp } from '../store/app';
import { cx } from './primitives';

/**
 * Transient messages. Never focusable and never blocking: on a TV, a modal
 * error that steals focus is far more disruptive than on a desktop, because
 * recovering from it costs a dozen button presses.
 */
export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  if (!toasts.length) return null;

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={cx('toast', toast.tone !== 'neutral' && `toast--${toast.tone}`)}>
          <span aria-hidden="true">
            {toast.tone === 'bad' ? '⚠' : toast.tone === 'good' ? '✓' : 'ℹ'}
          </span>
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
