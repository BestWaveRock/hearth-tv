import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AccessMode, MediaRole, SourceInput, SourceKind, SourceSummary } from '../../shared/types';
import { Field } from '../components/Field';
import { Button, Chip, EmptyState, Row, Segments, Spinner } from '../components/primitives';
import { FocusGroup, FocusScope } from '../focus';
import {
  directModeBlocker,
  proxyModeBlocker,
  suggestAccessMode,
  supportsDirect,
} from '../../shared/sources/reachability';
import { sanitiseBaseUrl } from '../../shared/sources/util';
import { ApiError, api } from '../lib/api';
import { testSourceConnection } from '../lib/media';
import { useDismissable } from '../lib/dismiss';
import { formatRelative } from '../lib/format';
import { useT, type T } from '../lib/i18n';
import { useApp } from '../store/app';

/**
 * Data sources.
 *
 * Three protocols, three sets of quirks, one form. Each kind gets its own
 * copy and its own placeholder, because the single most common setup failure is
 * pointing a WebDAV client at a web UI URL rather than at the DAV endpoint —
 * and a generic "Server URL" label does nothing to prevent that.
 */

interface KindMeta {
  kind: SourceKind;
  name: string;
  tagline: string;
  urlLabel: string;
  urlPlaceholder: string;
  urlHint: string;
  usesRootPath: boolean;
  tokenLabel?: string;
  tokenHint?: string;
  defaultMedia: MediaRole;
}

function getKinds(t: T): KindMeta[] {
  return [
    {
      kind: 'webdav',
      name: 'WebDAV',
      tagline: t('src.kind.webdav.tagline'),
      urlLabel: t('src.kind.webdav.urlLabel'),
      urlPlaceholder: t('src.kind.webdav.urlPlaceholder'),
      urlHint: t('src.kind.webdav.urlHint'),
      usesRootPath: true,
      defaultMedia: 'video',
    },
    {
      kind: 'navidrome',
      name: 'Navidrome',
      tagline: t('src.kind.navidrome.tagline'),
      urlLabel: t('src.kind.navidrome.urlLabel'),
      urlPlaceholder: t('src.kind.navidrome.urlPlaceholder'),
      urlHint: t('src.kind.navidrome.urlHint'),
      usesRootPath: false,
      defaultMedia: 'music',
    },
    {
      kind: 'openlist',
      name: 'OpenList',
      tagline: t('src.kind.openlist.tagline'),
      urlLabel: t('src.kind.openlist.urlLabel'),
      urlPlaceholder: t('src.kind.openlist.urlPlaceholder'),
      urlHint: t('src.kind.openlist.urlHint'),
      usesRootPath: true,
      tokenLabel: t('src.kind.openlist.tokenLabel'),
      tokenHint: t('src.kind.openlist.tokenHint'),
      defaultMedia: 'video',
    },
  ];
}

function metaFor(kind: SourceKind, kinds: KindMeta[]): KindMeta {
  return kinds.find((k) => k.kind === kind) ?? kinds[0];
}

export function SourcesScreen() {
  const sources = useApp((s) => s.sources);
  const refreshSources = useApp((s) => s.refreshSources);
  const toast = useApp((s) => s.toast);
  const t = useT();
  const kinds = getKinds(t);

  const [editing, setEditing] = useState<SourceSummary | 'new' | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  useEffect(() => {
    void refreshSources();
  }, [refreshSources]);

  const test = useCallback(
    async (source: SourceSummary) => {
      setTesting(source.id);
      try {
        const res = await testSourceConnection(source);
        toast(`${source.name}: ${res.message}`, res.ok ? 'good' : 'bad');
      } catch (err) {
        toast(err instanceof ApiError ? err.message : t('src.testFail'), 'bad');
      } finally {
        setTesting(null);
        void refreshSources();
      }
    },
    [refreshSources, toast],
  );

  return (
    <div className="screen__scroll">
      <header className="pad-gutter stack stack-xs">
        <p className="t-label">{t('src.title')}</p>
        <h1 className="t-title">{t('src.heading')}</h1>
        <p className="t-body" style={{ maxWidth: '68ch' }}>
          {t('src.body')}
        </p>
      </header>

      <FocusGroup name="sources-actions">
        <div className="pad-gutter inline inline-sm wrap mt-md">
          <Button variant="primary" priority={8} onSelect={() => setEditing('new')}>
            {t('src.add')}
          </Button>
          <Button variant="ghost" onSelect={() => void refreshSources()}>
            {t('src.reload')}
          </Button>
        </div>
      </FocusGroup>

      {!sources.length ? (
        <EmptyState glyph="⛁" title={t('src.none.title')} body={t('src.none.body')} />
      ) : (
        <FocusGroup name="sources-list">
          <div className="rows mt-md">
            {sources.map((source) => (
              <Row
                key={source.id}
                lead={<span aria-hidden="true">{glyphFor(source.kind)}</span>}
                title={
                  <>
                    {source.name}{' '}
                    <span className="faint" style={{ fontWeight: 400 }}>
                      {metaFor(source.kind, kinds).name}
                    </span>
                  </>
                }
                subtitle={
                  <>
                    {source.baseUrl}
                    {source.rootPath !== '/' ? source.rootPath : ''}
                    {source.usernameMasked ? ` · ${source.usernameMasked}` : ` · ${t('src.anonymous')}`}
                  </>
                }
                tail={
                  <>
                    {testing === source.id ? <Spinner /> : null}
                    <Chip>
                      {source.access === 'direct' ? t('src.modeDirect') : t('src.modeProxy')}
                    </Chip>
                    {source.lastError ? (
                      <Chip tone="bad">{t('src.problem')}</Chip>
                    ) : source.lastOkAt ? (
                      <Chip tone="live">{formatRelative(source.lastOkAt)}</Chip>
                    ) : (
                      <Chip tone="warn">{t('src.untested')}</Chip>
                    )}
                  </>
                }
                onSelect={() => setEditing(source)}
              />
            ))}
          </div>
        </FocusGroup>
      )}

      {sources.some((s) => s.lastError) ? (
        <div className="pad-gutter mt-md">
          {sources
            .filter((s) => s.lastError)
            .map((s) => (
              <p key={s.id} className="field__error">
                {s.name}: {s.lastError}
              </p>
            ))}
        </div>
      ) : null}

      {editing ? (
        <SourceDialog
          source={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refreshSources();
          }}
          onTest={editing === 'new' ? undefined : () => void test(editing)}
        />
      ) : null}
    </div>
  );
}

function glyphFor(kind: SourceKind): string {
  if (kind === 'navidrome') return '♪';
  if (kind === 'openlist') return '☁';
  return '⛁';
}

/* ------------------------------ the form ------------------------------- */

function SourceDialog({
  source,
  onClose,
  onSaved,
  onTest,
}: {
  source: SourceSummary | null;
  onClose: () => void;
  onSaved: () => void;
  onTest?: () => void;
}) {
  const toast = useApp((s) => s.toast);
  const t = useT();
  const kinds = getKinds(t);

  const [kind, setKind] = useState<SourceKind>(source?.kind ?? 'webdav');
  const [name, setName] = useState(source?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(source?.baseUrl ?? '');
  const [rootPath, setRootPath] = useState(source?.rootPath ?? '/');
  const [media, setMedia] = useState<MediaRole>(source?.media ?? 'video');
  const [access, setAccess] = useState<AccessMode>(source?.access ?? 'proxy');
  /** Cleared once the user picks a mode themselves, so we stop overriding them. */
  const [accessTouched, setAccessTouched] = useState(source !== null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');

  const [busy, setBusy] = useState<'save' | 'test' | 'delete' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const meta = metaFor(kind, kinds);
  const isNew = source === null;

  // Back closes the dialog instead of popping out of the Sources screen.
  useDismissable(onClose, busy === null);

  const origin = typeof location === 'undefined' ? '' : location.origin;
  const directAllowed = supportsDirect(kind);

  /**
   * Suggest a mode from the address the user is typing.
   *
   * Typing a `192.168.x.x` address and then being told the server cannot reach it
   * is a bad experience when the answer — direct mode — is already known. This
   * flips the default once, and stops as soon as the user chooses for themselves.
   */
  useEffect(() => {
    if (accessTouched || !baseUrl.trim() || !directAllowed) return;
    const suggested = suggestAccessMode(baseUrl.trim(), kind);
    if (suggested !== access) setAccess(suggested);
  }, [baseUrl, kind, accessTouched, directAllowed, access]);

  // Keep WebDAV out of a mode it cannot support, even if switched after the fact.
  useEffect(() => {
    if (!directAllowed && access === 'direct') setAccess('proxy');
  }, [directAllowed, access]);

  /** Whichever rule currently rules this address out, phrased for a human. */
  const addressWarning = useMemo(() => {
    const url = baseUrl.trim();
    if (!url) return null;
    let normalised: string;
    try {
      normalised = sanitiseBaseUrl(url);
    } catch {
      return null;
    }

    if (access === 'direct') {
      const blocker = directModeBlocker(origin, normalised, kind);
      if (blocker?.code === 'mixed-content') return t('src.access.mixedContent');
      if (blocker?.code === 'kind-unsupported') return t('src.access.directWebdav');
      return null;
    }

    const blocker = proxyModeBlocker(origin, normalised);
    if (blocker?.code === 'private-from-cloud') {
      return directAllowed ? t('src.access.suggestDirect') : t('src.privateAddress');
    }
    return null;
  }, [baseUrl, access, kind, origin, directAllowed, t]);

  const body = (): SourceInput => ({
    kind,
    name: name.trim() || meta.name,
    baseUrl,
    rootPath: meta.usesRootPath ? rootPath : '/',
    media,
    access,
    // Blank fields are omitted on edit so a stored password is not wiped by
    // someone renaming the source.
    ...(username || isNew ? { username } : {}),
    ...(password ? { password } : {}),
    ...(token ? { token } : {}),
  });

  const runTest = async () => {
    setBusy('test');
    setResult(null);
    setError(null);
    try {
      if (access === 'direct') {
        // Direct mode has to be tested from the browser, because that is the
        // code path the media will actually take. Asking the server would prove
        // nothing: it cannot reach a LAN address, and it is not subject to CORS.
        if (isNew || password || username || token) {
          setResult({ ok: false, message: t('src.saveThenTestDirect') });
        } else {
          setResult(await testSourceConnection(source));
        }
      } else if (isNew || password || username || token) {
        setResult(await api.testDraft(body()));
      } else {
        setResult(await api.testSource(source.id));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('src.testFail'));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy('save');
    setError(null);
    try {
      if (isNew) await api.addSource(body());
      else await api.updateSource(source.id, body());
      toast(
        isNew
          ? t('src.added', { name: name || meta.name })
          : t('src.updated', { name: name || meta.name }),
        'good',
      );
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('src.saveFail'));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!source) return;
    setBusy('delete');
    try {
      await api.deleteSource(source.id);
      toast(t('src.removed', { name: source.name }), 'neutral');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('src.removeFail'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-label={isNew ? t('src.add') : t('src.editSource')}>
      <FocusScope name="source-dialog">
        <div className="dialog dialog--wide glass panel">
          <header className="stack stack-xs">
            <p className="t-label">{isNew ? t('src.newSource') : t('src.editSource')}</p>
            <h2 className="t-title">{meta.name}</h2>
            <p className="t-body">{meta.tagline}</p>
          </header>

          {isNew ? (
            <div className="stack stack-xs">
              <p className="t-label">{t('src.type')}</p>
              <Segments
                ariaLabel={t('src.type')}
                value={kind}
                onChange={(next) => {
                  setKind(next);
                  setMedia(metaFor(next, kinds).defaultMedia);
                  setResult(null);
                }}
                options={kinds.map((k) => ({ value: k.kind, label: k.name }))}
              />
            </div>
          ) : null}

          <div className="form-grid">
            <Field
              label={t('src.name')}
              value={name}
              onChange={setName}
              placeholder={`My ${meta.name}`}
              priority={5}
              hint={t('src.nameHint')}
            />

            <Field
              label={meta.urlLabel}
              value={baseUrl}
              onChange={setBaseUrl}
              kind="url"
              placeholder={meta.urlPlaceholder}
              hint={meta.urlHint}
            />

            {meta.usesRootPath ? (
              <Field
                label={t('src.folder')}
                value={rootPath}
                onChange={setRootPath}
                placeholder="/"
                hint={t('src.folderHint')}
              />
            ) : null}

            <Field
              label={t('src.username')}
              value={username}
              onChange={setUsername}
              placeholder={source?.usernameMasked ?? t('src.blankForAnonymous')}
              hint={isNew ? undefined : t('src.keepUsername')}
            />

            <Field
              label={t('src.password')}
              value={password}
              onChange={setPassword}
              kind="password"
              placeholder={
                source?.hasCredentials ? t('src.passwordStored') : '••••••••'
              }
              hint={t('src.passwordHint')}
            />

            {meta.tokenLabel ? (
              <Field
                label={meta.tokenLabel}
                value={token}
                onChange={setToken}
                kind="password"
                placeholder={t('src.optional')}
                hint={meta.tokenHint}
              />
            ) : null}

            <div className="stack stack-xs">
              <p className="t-label">{t('src.mediaType')}</p>
              <Segments
                ariaLabel={t('src.mediaType')}
                value={media}
                onChange={setMedia}
                options={[
                  { value: 'video', label: t('src.video') },
                  { value: 'music', label: t('src.music') },
                  { value: 'both', label: t('src.both') },
                ]}
              />
              <p className="field__hint">{t('src.mediaHint')}</p>
            </div>

            {/* The access mode. This is the choice that decides whether a NAS on
                the local network can be used at all, so it explains itself
                inline rather than hiding behind a tooltip. */}
            <div className="stack stack-xs">
              <p className="t-label">{t('src.access')}</p>
              {directAllowed ? (
                <Segments
                  ariaLabel={t('src.access')}
                  value={access}
                  onChange={(next) => {
                    setAccess(next);
                    setAccessTouched(true);
                    setResult(null);
                  }}
                  options={[
                    { value: 'proxy', label: t('src.access.proxy') },
                    { value: 'direct', label: t('src.access.direct') },
                  ]}
                />
              ) : (
                <p className="field__hint">{t('src.access.directWebdav')}</p>
              )}

              <p className="field__hint">
                {access === 'direct' ? t('src.access.directHint') : t('src.access.proxyHint')}
              </p>

              {/* Live diagnosis of the address as it is typed. */}
              {addressWarning ? <p className="field__error">{addressWarning}</p> : null}

              {access === 'direct' && !addressWarning ? (
                <p className="field__hint">
                  {t('src.access.corsHelp')} <code className="warm">{origin}</code>
                </p>
              ) : null}
            </div>
          </div>

          {result ? (
            <p className={result.ok ? 'field__hint' : 'field__error'}>
              {result.ok ? '✓ ' : '✕ '}
              {result.message}
            </p>
          ) : null}
          {error ? <p className="field__error">{error}</p> : null}

          <div className="dialog__actions">
            <Button variant="primary" onSelect={() => void save()} disabled={busy !== null}>
              {busy === 'save' ? <Spinner /> : null}
              {isNew ? t('src.addAction') : t('src.saveChanges')}
            </Button>
            <Button onSelect={() => void runTest()} disabled={busy !== null}>
              {busy === 'test' ? <Spinner /> : null}
              {t('src.testConnection')}
            </Button>
            {onTest ? (
              <Button variant="ghost" onSelect={onTest} disabled={busy !== null}>
                {t('src.retestSaved')}
              </Button>
            ) : null}
            <span className="grow" />
            {!isNew ? (
              <Button variant="danger" onSelect={() => void remove()} disabled={busy !== null}>
                {busy === 'delete' ? <Spinner /> : null}
                {t('src.remove')}
              </Button>
            ) : null}
            <Button variant="ghost" onSelect={onClose} disabled={busy !== null}>
              {t('src.cancel')}
            </Button>
          </div>

          <p className="t-meta">{t('src.edgeHint')}</p>
        </div>
      </FocusScope>
    </div>
  );
}
