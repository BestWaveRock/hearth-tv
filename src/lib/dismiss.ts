import { useEffect, useRef } from 'react';

/**
 * A stack of "what does Back close right now?" handlers.
 *
 * Without this, the single Back button is ambiguous: it might need to close the
 * on-screen keyboard, or a source dialog, or pop a folder. A last-in-first-out
 * stack of dismiss handlers makes the answer unambiguous and keeps each dialog
 * responsible for its own dismissal, rather than teaching a global router about
 * every overlay in the app.
 */

type Dismiss = () => void;

const stack: Dismiss[] = [];

export function pushDismiss(fn: Dismiss): void {
  stack.push(fn);
}

export function removeDismiss(fn: Dismiss): void {
  const i = stack.lastIndexOf(fn);
  if (i >= 0) stack.splice(i, 1);
}

/** Runs the top-most handler. Returns false when nothing is open. */
export function dismissTop(): boolean {
  const fn = stack[stack.length - 1];
  if (!fn) return false;
  // Pop first: a handler that throws must not wedge the Back button forever.
  stack.pop();
  fn();
  return true;
}

/**
 * Registers a dismiss handler for as long as the component is mounted.
 *
 * The callback is held in a ref so registration happens exactly once. An earlier
 * version depended on `onDismiss` directly, which re-registered on every render
 * — and that was a real bug: a parent dialog re-rendering would remove and
 * re-push its handler *above* a child keyboard's, so Back closed the wrong one.
 */
export function useDismissable(onDismiss: () => void, active = true): void {
  const latest = useRef(onDismiss);
  latest.current = onDismiss;

  useEffect(() => {
    if (!active) return;
    const handler = () => latest.current();
    pushDismiss(handler);
    return () => removeDismiss(handler);
  }, [active]);
}
