import type { ReactNode } from 'react';
import { FocusGroup } from '../focus';

/**
 * A horizontal shelf.
 *
 * The rail is the scroll container; the focus engine finds it by walking up
 * from the focused tile and aligns the selection to a leading inset. Wrapping
 * children in a FocusGroup is what gives the shelf focus memory: leave it and
 * come back, and you land on the tile you left.
 */
export function Shelf({
  title,
  count,
  children,
  action,
  grid,
}: {
  title: ReactNode;
  count?: number;
  children: ReactNode;
  action?: ReactNode;
  /** Render as a wrapping grid instead of a scrolling rail. */
  grid?: boolean;
}) {
  return (
    <section className="shelf">
      <header className="shelf__head">
        <h2 className="t-section">{title}</h2>
        {count !== undefined ? (
          <span className="shelf__count t-num">
            {count} item{count === 1 ? '' : 's'}
          </span>
        ) : null}
        {action ? <div style={{ marginLeft: 'auto' }}>{action}</div> : null}
      </header>
      <FocusGroup name="shelf">
        <div className={grid ? 'rail rail--grid' : 'rail'}>{children}</div>
      </FocusGroup>
    </section>
  );
}
