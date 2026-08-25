/**
 * Suppresses the browser behaviours that have no place in a television.
 *
 * A web page in a browser tab is surrounded by affordances designed for
 * documents and mice: right-click menus, text selection, drag-and-drop,
 * pinch-zoom, swipe-to-go-back. On a TV driven by a remote, every one of them is
 * either useless or actively harmful — a remote's Menu button opening a
 * right-click menu is the exact problem this fixes.
 *
 * ## What cannot be suppressed, and why
 *
 * The volume and power keys on a Bluetooth remote are handled by the operating
 * system before the browser ever sees them. On macOS the HID subsystem consumes
 * volume, mute and power at the driver level: they adjust system volume or sleep
 * the Mac, and no `preventDefault()` can intervene because no event is
 * delivered. This is not a gap in this code — a web page is simply not permitted
 * to override a machine's hardware keys.
 *
 * The workable answers are: use the app's own volume control (Control Centre),
 * or read those buttons through WebHID, which bypasses the OS key mapping
 * entirely. `describeUnblockable()` explains this in the interface rather than
 * leaving the user to wonder.
 */

let installed = false;

export function installBrowserGuards(): () => void {
  if (installed) return () => undefined;
  installed = true;

  const stop = (event: Event) => event.preventDefault();

  /** The Menu button on many remotes maps to the context-menu key. */
  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  /** Ctrl/Cmd + wheel is pinch-zoom on a trackpad; it wrecks a TV layout. */
  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) event.preventDefault();
  };

  /** Safari's pinch gestures arrive as non-standard gesture events. */
  const onGesture = (event: Event) => event.preventDefault();

  /**
   * Browser-level zoom shortcuts, and the shortcuts that would navigate away
   * from the app entirely. Deliberately narrow: devtools and reload stay usable.
   */
  const onKeyDown = (event: KeyboardEvent) => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && ['Equal', 'Minus', 'Digit0', 'NumpadAdd', 'NumpadSubtract'].includes(event.code)) {
      event.preventDefault();
      return;
    }
    // Alt/Cmd + Arrow is history navigation on most platforms.
    if ((event.altKey || event.metaKey) && (event.code === 'ArrowLeft' || event.code === 'ArrowRight')) {
      event.preventDefault();
    }
  };

  /** Two-finger swipe back, and rubber-band overscroll. */
  const onTouchMove = (event: TouchEvent) => {
    if (event.touches.length > 1) event.preventDefault();
  };

  document.addEventListener('contextmenu', onContextMenu, { capture: true });
  document.addEventListener('dragstart', stop);
  document.addEventListener('selectstart', stop);
  document.addEventListener('gesturestart', onGesture);
  document.addEventListener('gesturechange', onGesture);
  document.addEventListener('gestureend', onGesture);
  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown, { capture: true });
  document.addEventListener('touchmove', onTouchMove, { passive: false });

  return () => {
    document.removeEventListener('contextmenu', onContextMenu, { capture: true });
    document.removeEventListener('dragstart', stop);
    document.removeEventListener('selectstart', stop);
    document.removeEventListener('gesturestart', onGesture);
    document.removeEventListener('gesturechange', onGesture);
    document.removeEventListener('gestureend', onGesture);
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKeyDown, { capture: true });
    document.removeEventListener('touchmove', onTouchMove);
    installed = false;
  };
}

/* ------------------------------ fullscreen ------------------------------ */

export function isFullscreen(): boolean {
  return Boolean(document.fullscreenElement);
}

/**
 * Immersive fullscreen. Also asks for the keyboard lock, which is what stops
 * Escape from silently dropping out of fullscreen mid-film — without it, the
 * remote's Back button doubles as "exit fullscreen".
 */
export async function enterFullscreen(): Promise<void> {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
    const keyboard = (navigator as Navigator & {
      keyboard?: { lock?: (keys?: string[]) => Promise<void> };
    }).keyboard;
    // Only available over HTTPS in Chromium, and only in fullscreen.
    await keyboard?.lock?.(['Escape', 'F11']);
  } catch {
    // A user gesture is required, and some browsers refuse outright. Not fatal.
  }
}

export async function exitFullscreen(): Promise<void> {
  try {
    const keyboard = (navigator as Navigator & {
      keyboard?: { unlock?: () => void };
    }).keyboard;
    keyboard?.unlock?.();
    if (document.fullscreenElement) await document.exitFullscreen();
  } catch {
    /* nothing useful to do */
  }
}

export async function toggleFullscreen(): Promise<void> {
  if (isFullscreen()) await exitFullscreen();
  else await enterFullscreen();
}

/**
 * Whether this page is running inside the native macOS wrapper, which handles
 * fullscreen and hardware keys itself.
 */
export function isNativeShell(): boolean {
  return typeof navigator !== 'undefined' && /HearthShell/.test(navigator.userAgent);
}
