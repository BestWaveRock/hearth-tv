/**
 * The focus engine.
 *
 * On a TV there is no pointer, so the *only* way to reach anything is spatial
 * navigation. This module owns a registry of focusable rectangles and answers
 * one question well: given the focused element and a direction, what should be
 * focused next?
 *
 * Three behaviours make it feel like tvOS rather than like tabbing a web page:
 *
 *  1. Geometry, not DOM order. Candidates are scored by axial distance, cross
 *     axis overlap and centre alignment.
 *  2. Focus memory. Leaving a row and coming back lands on the item you left,
 *     which is what makes long shelves navigable.
 *  3. Scopes. An open dialog pushes a scope, so navigation cannot leak into
 *     the screen behind it.
 */

export type Dir = 'up' | 'down' | 'left' | 'right';

export type Align = 'lead' | 'center' | 'nearest' | 'start';

export interface FocusNode {
  id: string;
  el: HTMLElement;
  scope: string;
  /** Container id used for focus memory (usually a row or grid). */
  group?: string;
  /** Explicit navigation escape hatches, by target id or resolver. */
  overrides?: Partial<Record<Dir, string | null | (() => string | null)>>;
  onSelect?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onLongSelect?: () => void;
  disabled?: boolean;
  /** Weight for "where should focus land when this scope opens". Higher wins. */
  priority?: number;
  align?: Align;
}

type Listener = (id: string | null, previous: string | null) => void;

const nodes = new Map<string, FocusNode>();
const groupMemory = new Map<string, string>();
const scopeMemory = new Map<string, string>();
const listeners = new Set<Listener>();

let scopeStack: string[] = ['root'];
let currentId: string | null = null;
/** Set while the engine itself is moving focus, to ignore reflex DOM events. */
let settling = false;

export function activeScope(): string {
  return scopeStack[scopeStack.length - 1];
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(next: string | null, prev: string | null): void {
  for (const fn of listeners) fn(next, prev);
}

/* ----------------------------- registration ---------------------------- */

export function register(node: FocusNode): () => void {
  nodes.set(node.id, node);
  node.el.dataset.focusId = node.id;

  // First arrival in a scope claims focus so the screen is never dead.
  if (node.scope === activeScope() && currentId === null && !node.disabled) {
    queueRestore(node.scope);
  }

  return () => {
    const wasFocused = currentId === node.id;
    nodes.delete(node.id);
    if (wasFocused) {
      currentId = null;
      // The focused element unmounted (e.g. a list re-rendered); recover.
      queueRestore(activeScope());
    }
  };
}

export function updateNode(id: string, patch: Partial<FocusNode>): void {
  const existing = nodes.get(id);
  if (existing) nodes.set(id, { ...existing, ...patch });
}

/* -------------------------------- scopes ------------------------------- */

export function pushScope(scope: string): void {
  if (currentId) scopeMemory.set(activeScope(), currentId);
  scopeStack.push(scope);
  currentId = null;
  queueRestore(scope);
}

export function popScope(scope?: string): void {
  if (scopeStack.length <= 1) return;
  if (scope && activeScope() !== scope) {
    // Tolerate out-of-order teardown during React unmount cascades.
    scopeStack = scopeStack.filter((s) => s !== scope);
  } else {
    scopeStack.pop();
  }
  currentId = null;
  queueRestore(activeScope());
}

let restoreHandle: number | null = null;

/**
 * Focus restoration is deferred to the next frame because React commits
 * children in bursts; picking a target mid-commit chooses the wrong element.
 */
function queueRestore(scope: string): void {
  if (restoreHandle !== null) cancelAnimationFrame(restoreHandle);
  restoreHandle = requestAnimationFrame(() => {
    restoreHandle = null;
    if (activeScope() !== scope) return;
    if (currentId && nodes.has(currentId)) return;

    const remembered = scopeMemory.get(scope);
    if (remembered && isFocusable(nodes.get(remembered))) {
      focus(remembered);
      return;
    }
    focusFirstInScope(scope);
  });
}

export function focusFirstInScope(scope: string): boolean {
  const candidates = [...nodes.values()].filter((n) => n.scope === scope && isFocusable(n));
  if (!candidates.length) return false;

  candidates.sort((a, b) => {
    const p = (b.priority ?? 0) - (a.priority ?? 0);
    if (p !== 0) return p;
    const ra = a.el.getBoundingClientRect();
    const rb = b.el.getBoundingClientRect();
    return ra.top - rb.top || ra.left - rb.left;
  });
  focus(candidates[0].id);
  return true;
}

/* ------------------------------ visibility ----------------------------- */

function isFocusable(node?: FocusNode): node is FocusNode {
  if (!node || node.disabled) return false;
  const el = node.el;
  if (!el.isConnected) return false;
  // offsetParent is null for display:none subtrees; cheaper than getComputedStyle.
  if (el.offsetParent === null && el.getClientRects().length === 0) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  if (el.closest('[data-focus-inert="true"]')) return false;
  return true;
}

/* ------------------------------- scoring ------------------------------- */

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  cx: number;
  cy: number;
}

/** Builds a Box from x/y/width/height. Exported so tests need no DOM. */
export function makeBox(x: number, y: number, width: number, height: number): Box {
  return {
    left: x,
    right: x + width,
    top: y,
    bottom: y + height,
    cx: x + width / 2,
    cy: y + height / 2,
  };
}

function boxOf(el: HTMLElement): Box {
  const r = el.getBoundingClientRect();
  return makeBox(r.left, r.top, r.width, r.height);
}

/** Lower is better; `null` means the candidate is not in this direction. */
export function score(a: Box, b: Box, dir: Dir): number | null {
  const EPS = 3;
  let axial: number;
  let crossGap: number;
  let crossAlign: number;

  if (dir === 'right' || dir === 'left') {
    if (dir === 'right') {
      if (b.cx <= a.cx + EPS || b.left < a.left + EPS) return null;
      axial = Math.max(0, b.left - a.right);
    } else {
      if (b.cx >= a.cx - EPS || b.right > a.right - EPS) return null;
      axial = Math.max(0, a.left - b.right);
    }
    const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    crossGap = overlap > 0 ? 0 : -overlap;
    crossAlign = Math.abs(b.cy - a.cy);
  } else {
    if (dir === 'down') {
      if (b.cy <= a.cy + EPS || b.top < a.top + EPS) return null;
      axial = Math.max(0, b.top - a.bottom);
    } else {
      if (b.cy >= a.cy - EPS || b.bottom > a.bottom - EPS) return null;
      axial = Math.max(0, a.top - b.bottom);
    }
    const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    crossGap = overlap > 0 ? 0 : -overlap;
    crossAlign = Math.abs(b.cx - a.cx);
  }

  // Cross-axis drift is punished hard: on a TV, "down" must not slide sideways.
  return axial + crossGap * 5 + crossAlign * 0.4;
}

/**
 * The pure heart of spatial navigation: given the focused rectangle and a set of
 * candidate rectangles, which one should focus move to?
 *
 * Kept free of the DOM deliberately, so the geometry that decides whether this
 * feels like a television or like a broken web page can be tested directly.
 */
export function chooseCandidate<T extends { id: string; box: Box }>(
  from: Box,
  candidates: T[],
  dir: Dir,
): T | null {
  let best: T | null = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const s = score(from, candidate.box, dir);
    if (s === null) continue;
    if (s < bestScore) {
      bestScore = s;
      best = candidate;
    }
  }
  return best;
}

/* -------------------------------- moving ------------------------------- */

export function current(): FocusNode | null {
  return currentId ? nodes.get(currentId) ?? null : null;
}

export function currentIdOf(): string | null {
  return currentId;
}

export function move(dir: Dir): boolean {
  const from = current();
  if (!from || !isFocusable(from)) {
    return focusFirstInScope(activeScope());
  }

  // 1. Explicit override wins, always.
  const override = from.overrides?.[dir];
  if (override !== undefined) {
    const targetId = typeof override === 'function' ? override() : override;
    if (targetId === null) {
      bump(from.el, dir);
      return false;
    }
    if (targetId && isFocusable(nodes.get(targetId))) {
      focus(targetId);
      return true;
    }
  }

  // 2. Geometric search within the active scope.
  const scope = activeScope();
  const a = boxOf(from.el);
  const candidates: { id: string; box: Box; node: FocusNode }[] = [];

  for (const node of nodes.values()) {
    if (node.id === from.id || node.scope !== scope || !isFocusable(node)) continue;
    candidates.push({ id: node.id, box: boxOf(node.el), node });
  }

  const winner = chooseCandidate(a, candidates, dir);
  if (!winner) {
    bump(from.el, dir);
    return false;
  }
  let best: FocusNode = winner.node;

  // 3. Focus memory: entering a different group restores where you left it,
  //    but only across the axis that changes rows (up/down). Sideways moves
  //    must stay literal or the row would jump under your thumb.
  if (best.group && best.group !== from.group && (dir === 'up' || dir === 'down')) {
    const remembered = groupMemory.get(best.group);
    const rememberedNode = remembered ? nodes.get(remembered) : undefined;
    if (rememberedNode && rememberedNode.group === best.group && isFocusable(rememberedNode)) {
      best = rememberedNode;
    }
  }

  focus(best.id);
  return true;
}

export function focus(id: string, opts: { scroll?: boolean } = {}): void {
  const node = nodes.get(id);
  if (!node || !isFocusable(node)) return;
  if (currentId === id) {
    if (opts.scroll !== false) scrollIntoView(node);
    return;
  }

  const prev = currentId ? nodes.get(currentId) : undefined;
  if (prev) {
    prev.el.classList.remove('is-focused');
    prev.el.removeAttribute('data-focused');
    prev.onBlur?.();
  }

  currentId = id;
  if (node.group) groupMemory.set(node.group, id);
  scopeMemory.set(node.scope, id);

  node.el.classList.add('is-focused');
  node.el.dataset.focused = 'true';

  settling = true;
  // Focusing the real element keeps screen readers and IME input working.
  try {
    node.el.focus({ preventScroll: true });
  } catch {
    /* not focusable natively; the visual class is enough */
  }
  settling = false;

  if (opts.scroll !== false) scrollIntoView(node);
  node.onFocus?.();
  emit(id, prev?.id ?? null);
}

export function select(): boolean {
  const node = current();
  if (!node || node.disabled) return false;
  pulse(node.el);
  node.onSelect?.();
  return true;
}

export function isSettling(): boolean {
  return settling;
}

/* ------------------------------ scrolling ------------------------------ */

let smoothScroll = true;
export function setSmoothScroll(on: boolean): void {
  smoothScroll = on;
}

/**
 * Walks up the ancestor chain and scrolls every scrollable container so the
 * focused element sits where a TV UI expects it: rows align to a leading
 * inset, vertical scrollers keep the row comfortably off the screen edge.
 */
function scrollIntoView(node: FocusNode): void {
  const align = node.align ?? 'lead';
  let el: HTMLElement | null = node.el;
  const behavior: ScrollBehavior = smoothScroll ? 'smooth' : 'auto';

  while (el && el.parentElement) {
    const parent: HTMLElement = el.parentElement;
    const styles = getComputedStyle(parent);
    const scrollsX = /(auto|scroll)/.test(styles.overflowX) && parent.scrollWidth > parent.clientWidth + 2;
    const scrollsY = /(auto|scroll)/.test(styles.overflowY) && parent.scrollHeight > parent.clientHeight + 2;

    if (scrollsX || scrollsY) {
      const pr = parent.getBoundingClientRect();
      const nr = node.el.getBoundingClientRect();
      const opts: ScrollToOptions = { behavior };

      if (scrollsX) {
        // A generous inset keeps the previous poster peeking in, which is the
        // visual cue that tells you the shelf continues to the left.
        const inset = Math.min(160, Math.max(48, pr.width * 0.08));
        const offsetLeft = nr.left - pr.left + parent.scrollLeft;
        let target: number;
        if (align === 'center') target = offsetLeft - (pr.width - nr.width) / 2;
        else target = offsetLeft - inset;
        target = clamp(target, 0, parent.scrollWidth - parent.clientWidth);
        if (Math.abs(target - parent.scrollLeft) > 2) opts.left = target;
      }

      if (scrollsY) {
        const insetTop = Math.min(220, Math.max(64, pr.height * 0.18));
        const offsetTop = nr.top - pr.top + parent.scrollTop;
        let target: number;
        if (align === 'center') target = offsetTop - (pr.height - nr.height) / 2;
        else if (align === 'start') target = offsetTop - 24;
        else target = offsetTop - insetTop;
        target = clamp(target, 0, parent.scrollHeight - parent.clientHeight);
        if (Math.abs(target - parent.scrollTop) > 2) opts.top = target;
      }

      if (opts.left !== undefined || opts.top !== undefined) parent.scrollTo(opts);
    }

    el = parent;
    if (parent === document.body || parent === document.documentElement) break;
  }
}

function clamp(v: number, min: number, max: number): number {
  // A container that is not overflowing yields max < min; pin to min.
  if (max <= min) return min;
  return Math.max(min, Math.min(max, v));
}

/* ------------------------------ feedback ------------------------------- */

/** The soft rubber-band nudge tvOS gives you at the end of a row. */
function bump(el: HTMLElement, dir: Dir): void {
  if (!smoothScroll) return;
  const cls = dir === 'left' || dir === 'right' ? 'is-bumping-x' : 'is-bumping-y';
  const sign = dir === 'right' || dir === 'down' ? 1 : -1;
  el.style.setProperty('--bump-sign', String(sign));
  el.classList.remove('is-bumping-x', 'is-bumping-y');
  // Force a reflow so the animation restarts on a repeated press.
  void el.offsetWidth;
  el.classList.add(cls);
  window.setTimeout(() => el.classList.remove(cls), 340);
}

/** The press-down acknowledgement on select. */
function pulse(el: HTMLElement): void {
  el.classList.remove('is-pressed');
  void el.offsetWidth;
  el.classList.add('is-pressed');
  window.setTimeout(() => el.classList.remove('is-pressed'), 220);
}
