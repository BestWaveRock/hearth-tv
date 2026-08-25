import { useCallback, useEffect, useRef, useState } from 'react';
import { Field } from '../components/Field';
import { Shelf } from '../components/Shelf';
import { Tile } from '../components/Tile';
import { Button, EmptyState, Spinner } from '../components/primitives';
import { FocusGroup } from '../focus';
import { ApiError, api, type SearchGroup } from '../lib/api';
import { useT } from '../lib/i18n';
import { useOpenEntry } from '../lib/open';
import { canUseDirect, searchSource } from '../lib/media';
import { useApp } from '../store/app';

/**
 * Search across every connected source.
 *
 * The server fans out with `Promise.allSettled`, so a WebDAV share that has to
 * be crawled cannot stop Navidrome's indexed results from appearing. Queries are
 * debounced hard — 550ms — because each keystroke can mean a tree walk on
 * somebody's NAS.
 */
export function SearchScreen() {
  const sources = useApp((s) => s.sources);
  const push = useApp((s) => s.push);
  const openEntry = useOpenEntry();
  const t = useT();

  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const timer = useRef<number | null>(null);

  const run = useCallback(
    async (q: string) => {
      if (q.trim().length < 2) {
        setGroups([]);
        setSearched(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        // Proxy sources are searched by the Worker. Direct sources have to be
        // searched from the browser, because the Worker cannot reach them at all.
        // Both halves run in parallel, so a sleeping NAS does not hold up the
        // results from everything else.
        const directSources = useApp.getState().sources.filter((s) => canUseDirect(s));
        const [proxyRes, directResults] = await Promise.all([
          api.search(q),
          Promise.all(
            directSources.map(async (source) => ({
              sourceId: source.id,
              sourceName: source.name,
              entries: await searchSource(source, q),
            })),
          ),
        ]);

        setGroups([
          ...proxyRes.results,
          ...directResults.filter((group) => group.entries.length > 0),
        ]);
        setSearched(true);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Search failed.');
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void run(query), 550);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [query, run]);

  const total = groups.reduce((sum, g) => sum + g.entries.length, 0);

  return (
    <div className="screen__scroll">
      <header className="pad-gutter stack stack-sm">
        <p className="t-label">{t('search.title')}</p>
        <div style={{ maxWidth: 620 }}>
          <Field
            label={t('search.label')}
            value={query}
            onChange={setQuery}
            kind="search"
            placeholder={t('search.placeholder')}
            priority={10}
            hint={t('search.hint')}
          />
        </div>
        <div className="inline inline-sm">
          {loading ? <Spinner /> : null}
          <p className="t-meta">
            {loading
              ? t('search.searching')
              : searched
                ? t('search.results', {
                    n: total,
                    s: total === 1 ? '' : 's',
                    m: groups.length,
                    t: groups.length === 1 ? '' : 's',
                  })
                : t('search.sourcesConnected', {
                    n: sources.length,
                    s: sources.length === 1 ? '' : 's',
                  })}
          </p>
        </div>
      </header>

      {error ? <p className="pad-gutter field__error mt-md">{error}</p> : null}

      {groups.map((group) => (
        <Shelf key={group.sourceId} title={group.sourceName} count={group.entries.length} grid>
          {group.entries.map((entry) => (
            <Tile
              key={`${group.sourceId}:${entry.path}`}
              entry={entry}
              shape={entry.kind === 'album' || entry.kind === 'track' ? 'square' : 'poster'}
              onSelect={() =>
                openEntry(entry, group.sourceId, {
                  siblings: group.entries,
                  sourceName: group.sourceName,
                })
              }
            />
          ))}
        </Shelf>
      ))}

      {searched && !groups.length && !loading ? (
        <EmptyState
          glyph="⌕"
          title={t('search.nothing.title', { q: query })}
          body={t('search.nothing.body')}
        />
      ) : null}

      {!searched && !loading ? (
        <EmptyState glyph="⌕" title={t('search.hero.title')} body={t('search.hero.body')}>
          {!sources.length ? (
            <Button variant="primary" onSelect={() => push({ name: 'sources' })}>
              {t('search.addSourceFirst')}
            </Button>
          ) : null}
        </EmptyState>
      ) : null}

      <FocusGroup name="search-foot">
        <div />
      </FocusGroup>
    </div>
  );
}
