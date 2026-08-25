import type { CSSProperties, ReactNode } from 'react';
import { useFocusable, type UseFocusableOptions } from '../focus';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/* -------------------------------- Button -------------------------------- */

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';

interface ButtonProps extends UseFocusableOptions {
  children: ReactNode;
  variant?: ButtonVariant;
  block?: boolean;
  className?: string;
  style?: CSSProperties;
  icon?: ReactNode;
  /** Rendered as a circle; use for transport controls. */
  iconOnly?: boolean;
  ariaLabel?: string;
}

export function Button({
  children,
  variant = 'default',
  block,
  className,
  style,
  icon,
  iconOnly,
  ariaLabel,
  ...focusOptions
}: ButtonProps) {
  const f = useFocusable<HTMLButtonElement>(focusOptions);
  return (
    <button
      ref={f.ref}
      className={cx(
        'focusable btn',
        variant !== 'default' && `btn--${variant}`,
        block && 'btn--block',
        iconOnly && 'btn--icon',
        className,
      )}
      style={style}
      aria-disabled={focusOptions.disabled ? 'true' : undefined}
      aria-label={ariaLabel}
      {...f.props}
    >
      {icon}
      {iconOnly ? null : children}
      {iconOnly ? <span className="sr-only">{children}</span> : null}
    </button>
  );
}

/* --------------------------------- Row ---------------------------------- */

interface RowProps extends UseFocusableOptions {
  title: ReactNode;
  subtitle?: ReactNode;
  lead?: ReactNode;
  tail?: ReactNode;
  playing?: boolean;
  className?: string;
}

export function Row({ title, subtitle, lead, tail, playing, className, ...focusOptions }: RowProps) {
  const f = useFocusable<HTMLButtonElement>(focusOptions);
  return (
    <button
      ref={f.ref}
      className={cx('focusable row', playing && 'row--playing', className)}
      {...f.props}
    >
      {lead !== undefined ? <span className="row__lead">{lead}</span> : null}
      <span className="row__body">
        <span className="row__title clamp-1">{title}</span>
        {subtitle ? <span className="row__sub clamp-1">{subtitle}</span> : null}
      </span>
      {tail !== undefined ? <span className="row__tail">{tail}</span> : null}
    </button>
  );
}

/* ------------------------------- Segments ------------------------------- */

interface SegmentsProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
}

/** A focusable enum picker; each segment is its own navigation target. */
export function Segments<T extends string>({ options, value, onChange, ariaLabel }: SegmentsProps<T>) {
  return (
    <div className="segments" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => (
        <Segment
          key={option.value}
          label={option.label}
          active={option.value === value}
          onSelect={() => onChange(option.value)}
        />
      ))}
    </div>
  );
}

function Segment({ label, active, onSelect }: { label: string; active: boolean; onSelect: () => void }) {
  const f = useFocusable<HTMLButtonElement>({ onSelect });
  return (
    <button
      ref={f.ref}
      className="focusable segment"
      data-active={active}
      role="radio"
      aria-checked={active}
      {...f.props}
    >
      {label}
    </button>
  );
}

/* --------------------------------- Chip --------------------------------- */

export function Chip({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'live' | 'warn' | 'bad';
}) {
  return <span className={cx('chip', tone !== 'neutral' && `chip--${tone}`)}>{children}</span>;
}

/* ------------------------------- Feedback ------------------------------- */

export function Spinner() {
  return <span className="spinner" role="status" aria-label="Loading" />;
}

export function EmptyState({
  glyph = '·',
  title,
  body,
  children,
}: {
  glyph?: ReactNode;
  title: string;
  body?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty__glyph" aria-hidden="true">
        {glyph}
      </div>
      <h2 className="t-title">{title}</h2>
      {body ? <p className="t-body" style={{ maxWidth: '48ch' }}>{body}</p> : null}
      {children ? <div className="inline inline-sm wrap center mt-md">{children}</div> : null}
    </div>
  );
}

/** Placeholder shelf shown while the first listing loads. */
export function SkeletonShelf({ count = 6 }: { count?: number }) {
  return (
    <div className="shelf" aria-hidden="true">
      <div className="shelf__head">
        <div className="skeleton" style={{ width: 190, height: 22, borderRadius: 8 }} />
      </div>
      <div className="rail">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="tile" style={{ pointerEvents: 'none' }}>
            <div className="skeleton" style={{ aspectRatio: '2 / 3' }} />
            <div className="skeleton" style={{ height: 14, borderRadius: 6, marginTop: 4 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Animated equaliser bars marking the track that is currently playing. */
export function Bars({ paused }: { paused?: boolean }) {
  return (
    <span className="bars" data-paused={paused ? 'true' : 'false'} aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}
