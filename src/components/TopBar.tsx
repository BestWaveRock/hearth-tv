import { useEffect, useState } from 'react';
import { FocusGroup, useFocusable } from '../focus';
import { formatClock } from '../lib/format';
import { useT } from '../lib/i18n';
import { useApp, type Route } from '../store/app';
import { cx } from './primitives';

/** Live clock, ticking on the minute rather than the second. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // Align the first tick to the next minute boundary so the clock never
    // shows a stale minute for up to 59 seconds.
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    let interval: number | undefined;
    const timeout = window.setTimeout(() => {
      setNow(new Date());
      interval = window.setInterval(() => setNow(new Date()), 60_000);
    }, msToNextMinute);
    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, []);
  return now;
}

interface Tab {
  route: Route;
  label: string;
  icon: string;
}

const TAB_ROUTES: Pick<Tab, 'route' | 'icon'>[] = [
  { route: { name: 'home' }, icon: '⌂' },
  { route: { name: 'search' }, icon: '⌕' },
  { route: { name: 'nowplaying' }, icon: '♪' },
  { route: { name: 'sources' }, icon: '⛁' },
  { route: { name: 'settings' }, icon: '⚙' },
];

export function TopBar() {
  const stack = useApp((s) => s.stack);
  const clock24h = useApp((s) => s.settings.clock24h);
  const user = useApp((s) => s.user);
  const replace = useApp((s) => s.replace);
  const goHome = useApp((s) => s.goHome);
  const now = useNow();
  const t = useT();

  const active = stack[stack.length - 1];

  const tabs: Tab[] = TAB_ROUTES.map((tab) => {
    const labels: Record<string, string> = {
      home: t('top.tabs.home'),
      search: t('top.tabs.search'),
      nowplaying: t('top.tabs.nowplaying'),
      sources: t('top.tabs.sources'),
      settings: t('top.tabs.settings'),
    };
    return { ...tab, label: labels[tab.route.name] };
  });

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="brandmark" aria-hidden="true">
          <span className="brandmark__flame">◗</span>
        </span>
        <div>
          <p className="t-section" style={{ lineHeight: 1.1 }}>
            Hearth
          </p>
          {user ? <p className="t-meta">{user.displayName}</p> : null}
        </div>
      </div>

      <FocusGroup name="tabs">
        <nav className="tabs" aria-label="Main">
          {tabs.map((tab) => (
            <TabButton
              key={tab.route.name}
              tab={tab}
              active={active.name === tab.route.name}
              onSelect={() => {
                if (tab.route.name === 'home') goHome();
                else replace(tab.route);
              }}
            />
          ))}
        </nav>
      </FocusGroup>

      <p className="topbar__clock t-num">{formatClock(now, clock24h)}</p>
    </header>
  );
}

function TabButton({ tab, active, onSelect }: { tab: Tab; active: boolean; onSelect: () => void }) {
  // `align: start` keeps the page from scrolling when focus returns up here from
  // deep in a shelf. The negative priority matters more: when a screen mounts,
  // initial focus must land in the screen body, never on the navigation bar.
  const f = useFocusable<HTMLButtonElement>({ onSelect, align: 'start', priority: -10 });
  return (
    <button
      ref={f.ref}
      className={cx('focusable tab')}
      data-active={active}
      aria-current={active ? 'page' : undefined}
      {...f.props}
    >
      <span className="tab__icon" aria-hidden="true">
        {tab.icon}
      </span>
      {tab.label}
    </button>
  );
}
