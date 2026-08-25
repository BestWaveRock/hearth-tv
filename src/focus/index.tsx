import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import * as engine from './engine';
import type { Align, Dir } from './engine';

/** The scope every `useFocusable` inside this subtree belongs to. */
const ScopeContext = createContext<string>('root');
const GroupContext = createContext<string | undefined>(undefined);

/**
 * A navigation island. Mount one per screen and one per modal; navigation can
 * never escape the top-most scope, which is what stops a dialog from letting
 * you arrow into the page behind it.
 */
export function FocusScope({
  name,
  children,
  active = true,
}: {
  name: string;
  children: ReactNode;
  active?: boolean;
}) {
  const idSuffix = useId();
  const scope = useMemo(() => `${name}${idSuffix}`, [name, idSuffix]);

  useLayoutEffect(() => {
    if (!active) return;
    engine.pushScope(scope);
    return () => engine.popScope(scope);
  }, [scope, active]);

  return <ScopeContext.Provider value={scope}>{children}</ScopeContext.Provider>;
}

/** Groups items that should share focus memory — a shelf, a grid, a sidebar. */
export function FocusGroup({ name, children }: { name: string; children: ReactNode }) {
  const idSuffix = useId();
  const group = useMemo(() => `${name}${idSuffix}`, [name, idSuffix]);
  return <GroupContext.Provider value={group}>{children}</GroupContext.Provider>;
}

export interface UseFocusableOptions {
  onSelect?: () => void;
  onLongSelect?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  disabled?: boolean;
  /** Higher values win the initial focus when a scope opens. */
  priority?: number;
  align?: Align;
  overrides?: Partial<Record<Dir, string | null | (() => string | null)>>;
  /** Stable id, so focus survives a list reorder. Defaults to a generated one. */
  id?: string;
}

export interface FocusableHandle<T extends HTMLElement = HTMLElement> {
  ref: (el: T | null) => void;
  focused: boolean;
  id: string;
  /** Spread onto the element so mouse users are not locked out entirely. */
  props: {
    tabIndex: number;
    'data-focused': boolean | undefined;
    onMouseEnter: () => void;
    onClick: () => void;
  };
}

/**
 * Registers one element as a navigation target.
 *
 * Callbacks are held in a ref so that re-creating an inline arrow function on
 * every render does not thrash the registry — a real problem with long shelves.
 */
export function useFocusable<T extends HTMLElement = HTMLElement>(
  options: UseFocusableOptions = {},
): FocusableHandle<T> {
  const generatedId = useId();
  const id = options.id ?? generatedId;
  const scope = useContext(ScopeContext);
  const group = useContext(GroupContext);

  const elRef = useRef<T | null>(null);
  const [focused, setFocused] = useState(false);

  const latest = useRef(options);
  latest.current = options;

  const ref = useCallback((el: T | null) => {
    elRef.current = el;
  }, []);

  useLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;

    const unregister = engine.register({
      id,
      el,
      scope,
      group,
      priority: latest.current.priority,
      align: latest.current.align,
      disabled: latest.current.disabled,
      overrides: latest.current.overrides,
      onSelect: () => latest.current.onSelect?.(),
      onLongSelect: latest.current.onLongSelect
        ? () => latest.current.onLongSelect?.()
        : undefined,
      onFocus: () => {
        setFocused(true);
        latest.current.onFocus?.();
      },
      onBlur: () => {
        setFocused(false);
        latest.current.onBlur?.();
      },
    });
    return unregister;
    // `disabled` must re-register so the engine stops considering the node.
  }, [id, scope, group, options.disabled]);

  useEffect(() => {
    engine.updateNode(id, {
      disabled: options.disabled,
      overrides: options.overrides,
      align: options.align,
      priority: options.priority,
    });
  }, [id, options.disabled, options.overrides, options.align, options.priority]);

  const props = useMemo(
    () => ({
      tabIndex: -1,
      'data-focused': focused ? true : undefined,
      // Hover-to-focus and click-to-select: a remote is the intended input,
      // but a trackpad should not be a dead end during setup.
      onMouseEnter: () => {
        if (!latest.current.disabled) engine.focus(id, { scroll: false });
      },
      onClick: () => {
        if (latest.current.disabled) return;
        engine.focus(id, { scroll: false });
        latest.current.onSelect?.();
      },
    }),
    [focused, id],
  );

  return { ref, focused, id, props };
}

export { engine };
