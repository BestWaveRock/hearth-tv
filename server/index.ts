/// <reference types="@cloudflare/workers-types" />

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';

import {
  DEFAULT_SETTINGS,
  type AccessMode,
  type Entry,
  type Listing,
  type MediaRole,
  type RemoteProfile,
  type Settings,
  type SourceCredentials,
  type SourceSummary,
} from '../shared/types';
import { proxyModeBlocker, supportsDirect } from '../shared/sources/reachability';
import type { AppEnv, Env } from './env';
import { deleteCookie } from 'hono/cookie';
import {
  SESSION_COOKIE,
  createUser,
  getVault,
  issueSession,
  optionalAuth,
  pruneExpiredSessions,
  requireAuth,
  revokeSession,
  verifyLogin,
} from './auth';
import { newId, seal, unseal } from './crypto';
import { RemoteRoom, isPairingCode, newPairingCode } from './remote';
import {
  type Credentials,
  type SourceContext,
  type SourceRow,
  adapterFor,
  contextFromRow,
  crumbsFor,
  extOf,
  fetchSourceRows,
  isSourceKind,
  loadContext,
  noteSourceHealth,
  normalisePath,
  parentPath,
  rowToSummary,
  sanitiseBaseUrl,
} from './sources';

export { RemoteRoom };

const app = new Hono<AppEnv>();

const headers = secureHeaders({
  xFrameOptions: 'DENY',
  xContentTypeOptions: 'nosniff',
  referrerPolicy: 'no-referrer',
  crossOriginEmbedderPolicy: false,
});

/**
 * A WebSocket upgrade returns a 101 whose headers are immutable, so any attempt
 * to decorate it throws. Security headers are meaningless on a 101 in any case —
 * there is no document to protect — so the middleware is skipped for upgrades.
 */
app.use('*', async (c, next) => {
  if (c.req.header('upgrade')?.toLowerCase() === 'websocket') return next();
  return headers(c, next);
});

/* --------------------------------------------------------------------- *
 * Errors are always JSON on /api so the TV UI can render them calmly.
 * --------------------------------------------------------------------- */

app.onError((err, c) => {
  const isApi = new URL(c.req.url).pathname.startsWith('/api/');
  if (err instanceof HTTPException) {
    if (!isApi) return err.getResponse();
    return c.json({ error: err.message }, err.status);
  }
  console.error('Unhandled error:', err);
  const message = err instanceof Error ? err.message : 'Unexpected server error.';
  return isApi ? c.json({ error: message }, 500) : c.text(message, 500);
});

const api = new Hono<AppEnv>();

/* ------------------------------ health ------------------------------- */

api.get('/health', async (c) => {
  const checks: Record<string, string> = {};
  try {
    await c.env.DB.prepare('SELECT 1').first();
    checks.database = 'ok';
  } catch (e) {
    checks.database = e instanceof Error ? e.message : 'unavailable';
  }
  checks.encryptionKey = c.env.ENCRYPTION_KEY ? 'configured' : 'MISSING';
  const healthy = checks.database === 'ok' && checks.encryptionKey === 'configured';
  return c.json({ ok: healthy, app: c.env.APP_NAME ?? 'Hearth', checks }, healthy ? 200 : 503);
});

/* ------------------------------- auth -------------------------------- */

interface AuthBody {
  username?: unknown;
  password?: unknown;
  displayName?: unknown;
}

function readAuthBody(body: AuthBody): { username: string; password: string; displayName?: string } {
  const username = typeof body.username === 'string' ? body.username : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password) {
    throw new HTTPException(400, { message: 'Username and password are both required.' });
  }
  return {
    username,
    password,
    displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
  };
}

api.post('/auth/register', async (c) => {
  if (c.env.ALLOW_SIGNUP === 'false') {
    throw new HTTPException(403, { message: 'Registration is closed on this server.' });
  }
  const { username, password, displayName } = readAuthBody(await c.req.json<AuthBody>());
  const user = await createUser(c, username, password, displayName);
  await issueSession(c, user.id);
  await c.env.DB.prepare('INSERT INTO settings (user_id, json, updated_at) VALUES (?, ?, ?)')
    .bind(user.id, JSON.stringify(DEFAULT_SETTINGS), Date.now())
    .run();
  return c.json({ user, settings: DEFAULT_SETTINGS });
});

api.post('/auth/login', async (c) => {
  const { username, password } = readAuthBody(await c.req.json<AuthBody>());
  const user = await verifyLogin(c, username, password);
  await issueSession(c, user.id);
  return c.json({ user, settings: await loadSettings(c.env, user.id) });
});

api.post('/auth/logout', optionalAuth, async (c) => {
  await revokeSession(c);
  return c.json({ ok: true });
});

/**
 * Deletes the signed-in account and everything belonging to it.
 *
 * Anyone who can create an account should be able to remove it — both because
 * it is the decent default and because a self-hosted box otherwise accumulates
 * accounts that can never be revoked from inside the product.
 *
 * The password is required so that a stolen session cookie cannot destroy the
 * library. Every child table declares ON DELETE CASCADE, so removing the user
 * row takes sessions, sources, progress, favourites, settings and remote
 * profiles with it.
 */
api.delete('/me', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ password?: unknown }>().catch(() => ({ password: undefined }));
  const password = typeof body.password === 'string' ? body.password : '';

  if (!password) {
    throw new HTTPException(400, { message: 'Enter your password to delete this account.' });
  }
  // Throws 401 on a mismatch, in constant time.
  await verifyLogin(c, user.username, password);

  // Belt and braces: D1 honours foreign keys, but an older database created
  // before a schema change might not, and a half-deleted account is worse
  // than a clear error.
  for (const table of ['sessions', 'sources', 'progress', 'favorites', 'remote_profiles', 'settings']) {
    await c.env.DB.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(user.id).run();
  }
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();

  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

/* ------------------------------ profile ------------------------------ */

async function loadSettings(env: Env, userId: string): Promise<Settings> {
  const row = await env.DB.prepare('SELECT json FROM settings WHERE user_id = ?')
    .bind(userId)
    .first<{ json: string }>();
  if (!row) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(row.json) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

api.get('/me', optionalAuth, async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ user: null }, 200);

  const vault = await getVault(c);
  const rows = await fetchSourceRows(c.env, user.id);
  const sources = await Promise.all(rows.map((r) => rowToSummary(vault, r)));

  return c.json({
    user,
    settings: await loadSettings(c.env, user.id),
    sources,
    remoteProfiles: await loadRemoteProfiles(c.env, user.id),
    signupOpen: c.env.ALLOW_SIGNUP !== 'false',
  });
});

api.patch('/me/settings', requireAuth, async (c) => {
  const user = c.get('user');
  const patch = await c.req.json<Partial<Settings>>();
  const next: Settings = { ...(await loadSettings(c.env, user.id)), ...patch };

  // Clamp anything a malformed client could send.
  next.screensaverMinutes = Math.min(120, Math.max(1, Number(next.screensaverMinutes) || 5));
  next.seekStepSeconds = Math.min(120, Math.max(5, Number(next.seekStepSeconds) || 10));
  next.uiScale = Math.min(1.4, Math.max(0.8, Number(next.uiScale) || 1));
  next.language = next.language === 'zh' ? 'zh' : 'en';
  next.fullscreen = next.fullscreen === true;

  await c.env.DB.prepare(
    `INSERT INTO settings (user_id, json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
  )
    .bind(user.id, JSON.stringify(next), Date.now())
    .run();

  return c.json({ settings: next });
});

/* ------------------------------ sources ------------------------------ */

interface SourceBody {
  kind?: unknown;
  name?: unknown;
  baseUrl?: unknown;
  rootPath?: unknown;
  media?: unknown;
  access?: unknown;
  username?: unknown;
  password?: unknown;
  token?: unknown;
}

/**
 * A Worker deployed to Cloudflare runs in their network and physically cannot
 * open a socket to a RFC1918 address, so a LAN address in *proxy* mode is a
 * guaranteed timeout. Saying so up front is far kinder than the timeout.
 *
 * In *direct* mode a LAN address is the entire point — the browser does the
 * fetching, from inside the network — so the check does not apply.
 *
 * It is also skipped during local development, where workerd genuinely can
 * reach the LAN.
 */
function assertProxyReachable(baseUrl: string, requestUrl: string): void {
  if (proxyModeBlocker(new URL(requestUrl).origin, baseUrl)?.code === 'private-from-cloud') {
    const host = new URL(baseUrl).hostname;
    throw new HTTPException(400, {
      message:
        `“${host}” is a private address, and this server runs on Cloudflare's edge, so it cannot reach ` +
        `your local network. Either switch this source to Direct access, so your browser connects to it from ` +
        `inside the network, or expose the service publicly over HTTPS (a Cloudflare Tunnel is the usual way).`,
    });
  }
}

function parseSourceBody(body: SourceBody, requestUrl: string, partial = false) {
  const kind = body.kind;
  if (!partial || kind !== undefined) {
    if (!isSourceKind(kind)) {
      throw new HTTPException(400, { message: 'Source type must be webdav, navidrome or openlist.' });
    }
  }

  const nameRaw = typeof body.name === 'string' ? body.name.trim() : '';
  if (!partial && !nameRaw) throw new HTTPException(400, { message: 'Give this source a name.' });

  let baseUrl: string | undefined;
  if (typeof body.baseUrl === 'string' && body.baseUrl.trim()) {
    try {
      baseUrl = sanitiseBaseUrl(body.baseUrl);
    } catch (e) {
      throw new HTTPException(400, {
        message: e instanceof Error ? e.message : 'That server address is not a valid URL.',
      });
    }
  } else if (!partial) {
    throw new HTTPException(400, { message: 'Server address is required.' });
  }

  const MEDIA_ROLES: MediaRole[] = ['video', 'music', 'both'];
  const media: MediaRole | undefined =
    typeof body.media === 'string' && (MEDIA_ROLES as string[]).includes(body.media)
      ? (body.media as MediaRole)
      : undefined;

  const access: AccessMode | undefined =
    body.access === 'direct' || body.access === 'proxy' ? body.access : undefined;

  const effectiveKind = isSourceKind(kind) ? kind : undefined;

  // Direct mode requires the browser to authenticate a media element from the
  // URL alone, which WebDAV cannot do.
  if (access === 'direct' && effectiveKind && !supportsDirect(effectiveKind)) {
    throw new HTTPException(400, {
      message:
        'WebDAV cannot be used in Direct mode: it authenticates with a header, and a video element cannot send headers. Use Proxy access for WebDAV, or use OpenList in front of it.',
    });
  }

  // Only proxy sources must be reachable from Cloudflare.
  if (baseUrl && access !== 'direct') assertProxyReachable(baseUrl, requestUrl);

  return {
    kind: isSourceKind(kind) ? kind : undefined,
    name: nameRaw || undefined,
    baseUrl,
    rootPath: typeof body.rootPath === 'string' ? normalisePath(body.rootPath) : undefined,
    media,
    access,
    creds: {
      username: typeof body.username === 'string' ? body.username : undefined,
      password: typeof body.password === 'string' ? body.password : undefined,
      token: typeof body.token === 'string' ? body.token : undefined,
    } satisfies Credentials,
  };
}

api.get('/sources', requireAuth, async (c) => {
  const vault = await getVault(c);
  const rows = await fetchSourceRows(c.env, c.get('user').id);
  const sources: SourceSummary[] = await Promise.all(rows.map((r) => rowToSummary(vault, r)));
  return c.json({ sources });
});

api.post('/sources', requireAuth, async (c) => {
  const user = c.get('user');
  const vault = await getVault(c);
  const parsed = parseSourceBody(await c.req.json<SourceBody>(), c.req.url);

  const kind = parsed.kind!;
  const defaultMedia = kind === 'navidrome' ? 'music' : 'video';
  const id = newId();
  const now = Date.now();

  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM sources WHERE user_id = ?')
    .bind(user.id)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= 24) {
    throw new HTTPException(400, { message: 'You can connect up to 24 data sources.' });
  }

  await c.env.DB.prepare(
    `INSERT INTO sources (id, user_id, kind, name, base_url, root_path, media, access, secret_blob, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      user.id,
      kind,
      parsed.name!,
      parsed.baseUrl!,
      parsed.rootPath ?? '/',
      parsed.media ?? defaultMedia,
      parsed.access ?? 'proxy',
      await seal(vault, parsed.creds),
      count?.n ?? 0,
      now,
    )
    .run();

  const row = await c.env.DB.prepare('SELECT * FROM sources WHERE id = ?').bind(id).first<SourceRow>();
  return c.json({ source: await rowToSummary(vault, row!) }, 201);
});

api.patch('/sources/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const vault = await getVault(c);
  const id = c.req.param('id');

  const row = await c.env.DB.prepare('SELECT * FROM sources WHERE id = ? AND user_id = ?')
    .bind(id, user.id)
    .first<SourceRow>();
  if (!row) throw new HTTPException(404, { message: 'Source not found.' });

  const body = await c.req.json<SourceBody>();
  const parsed = parseSourceBody(body, c.req.url, true);

  // Credentials are only rewritten when the client actually sent new ones,
  // so an edit of the display name cannot silently wipe a stored password.
  let secretBlob = row.secret_blob;
  const sentCreds =
    parsed.creds.username !== undefined ||
    parsed.creds.password !== undefined ||
    parsed.creds.token !== undefined;

  if (sentCreds) {
    let existing: Credentials = {};
    try {
      existing = await unseal<Credentials>(vault, row.secret_blob);
    } catch {
      existing = {};
    }
    secretBlob = await seal(vault, {
      username: parsed.creds.username ?? existing.username,
      password: parsed.creds.password ?? existing.password,
      token: parsed.creds.token ?? existing.token,
    } satisfies Credentials);
  }

  await c.env.DB.prepare(
    `UPDATE sources SET kind = ?, name = ?, base_url = ?, root_path = ?, media = ?, access = ?, secret_blob = ?, last_error = NULL
      WHERE id = ? AND user_id = ?`,
  )
    .bind(
      parsed.kind ?? row.kind,
      parsed.name ?? row.name,
      parsed.baseUrl ?? row.base_url,
      parsed.rootPath ?? row.root_path,
      parsed.media ?? row.media,
      parsed.access ?? row.access ?? 'proxy',
      secretBlob,
      id,
      user.id,
    )
    .run();

  const updated = await c.env.DB.prepare('SELECT * FROM sources WHERE id = ?')
    .bind(id)
    .first<SourceRow>();
  return c.json({ source: await rowToSummary(vault, updated!) });
});

api.delete('/sources/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const res = await c.env.DB.prepare('DELETE FROM sources WHERE id = ? AND user_id = ?')
    .bind(id, user.id)
    .run();
  if (!res.meta.changes) throw new HTTPException(404, { message: 'Source not found.' });
  await c.env.DB.prepare('DELETE FROM progress WHERE user_id = ? AND source_id = ?')
    .bind(user.id, id)
    .run();
  await c.env.DB.prepare('DELETE FROM favorites WHERE user_id = ? AND source_id = ?')
    .bind(user.id, id)
    .run();
  return c.json({ ok: true });
});

/** Dry-run a connection before saving it, so setup fails fast and clearly. */
api.post('/sources/test', requireAuth, async (c) => {
  const parsed = parseSourceBody(await c.req.json<SourceBody>(), c.req.url);
  const kind = parsed.kind!;
  const ctx: SourceContext = {
    id: 'probe-' + newId(6),
    kind,
    name: parsed.name ?? 'probe',
    baseUrl: parsed.baseUrl!,
    rootPath: parsed.rootPath ?? '/',
    media: parsed.media ?? (kind === 'navidrome' ? 'music' : 'video'),
    creds: parsed.creds,
  };

  try {
    const message = await adapterFor(kind).test(ctx);
    return c.json({ ok: true, message });
  } catch (e) {
    return c.json({ ok: false, message: e instanceof Error ? e.message : 'Connection failed.' }, 200);
  }
});

/**
 * Hands the browser the plaintext credentials for a **direct** source.
 *
 * This is the one place secrets travel back to a client, so the rules are
 * strict and worth stating:
 *
 *  - Only for `access = 'direct'`. A proxy source's credentials never leave the
 *    Worker, because nothing in the browser needs them.
 *  - Only to the authenticated owner of that row.
 *  - Never cached, by us or by any intermediary.
 *
 * The trade-off is deliberate. Direct mode exists so the browser can talk to a
 * NAS on the local network, and it cannot authenticate to that NAS without the
 * password. The alternative — keeping the password only in the browser that
 * created it — would break the promise that signing in restores your sources on
 * any computer. Every response here is `no-store`, the transport is HTTPS, and
 * the strict CSP in `public/_headers` is what keeps an injected script from
 * reading it.
 */
api.get('/sources/:id/credentials', requireAuth, async (c) => {
  const user = c.get('user');
  const vault = await getVault(c);

  const row = await c.env.DB.prepare('SELECT * FROM sources WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), user.id)
    .first<SourceRow>();
  if (!row) throw new HTTPException(404, { message: 'Source not found.' });

  if ((row.access ?? 'proxy') !== 'direct') {
    throw new HTTPException(403, {
      message:
        'This source uses Proxy access, so its credentials stay on the server. Switch it to Direct access if the browser needs to connect itself.',
    });
  }

  let creds: SourceCredentials;
  try {
    creds = await unseal<SourceCredentials>(vault, row.secret_blob);
  } catch {
    throw new HTTPException(409, {
      message: `Credentials for “${row.name}” could not be decrypted. Open Settings and re-enter them.`,
    });
  }

  c.header('Cache-Control', 'no-store, private, max-age=0');
  return c.json({ credentials: creds });
});

api.post('/sources/:id/test', requireAuth, async (c) => {
  const vault = await getVault(c);
  const ctx = await loadContext(c.env, vault, c.get('user').id, c.req.param('id'));
  try {
    const message = await adapterFor(ctx.kind).test(ctx);
    await noteSourceHealth(c.env, ctx.id, null);
    return c.json({ ok: true, message });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Connection failed.';
    await noteSourceHealth(c.env, ctx.id, message);
    return c.json({ ok: false, message }, 200);
  }
});

/* ------------------------------ browsing ----------------------------- */

api.get('/browse', requireAuth, async (c) => {
  const sourceId = c.req.query('src');
  const path = normalisePath(c.req.query('path') ?? '/');
  if (!sourceId) throw new HTTPException(400, { message: 'Missing source id.' });

  const vault = await getVault(c);
  const ctx = await loadContext(c.env, vault, c.get('user').id, sourceId);

  try {
    const entries = await adapterFor(ctx.kind).list(ctx, path);
    await noteSourceHealth(c.env, ctx.id, null);
    const listing: Listing = {
      sourceId: ctx.id,
      path,
      parent: parentPath(path),
      entries,
      crumbs: crumbsFor(ctx.name, path),
    };
    return c.json(listing);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not read that folder.';
    await noteSourceHealth(c.env, ctx.id, message);
    throw new HTTPException(502, { message });
  }
});

api.get('/search', requireAuth, async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (q.length < 2) return c.json({ results: [] });

  const user = c.get('user');
  const vault = await getVault(c);
  const rows = await fetchSourceRows(c.env, user.id);

  const perSource = await Promise.allSettled(
    rows.map(async (row) => {
      const creds = await unseal<Credentials>(vault, row.secret_blob);
      const ctx = contextFromRow(row, creds);
      const adapter = adapterFor(ctx.kind);
      if (!adapter.search) return { sourceId: row.id, sourceName: row.name, entries: [] as Entry[] };
      return { sourceId: row.id, sourceName: row.name, entries: await adapter.search(ctx, q) };
    }),
  );

  const results = perSource
    .filter((r): r is PromiseFulfilledResult<{ sourceId: string; sourceName: string; entries: Entry[] }> =>
      r.status === 'fulfilled',
    )
    .map((r) => r.value)
    .filter((g) => g.entries.length > 0);

  return c.json({ results });
});

/** The Home screen: one request, every shelf. */
api.get('/home', requireAuth, async (c) => {
  const user = c.get('user');
  const vault = await getVault(c);
  const rows = await fetchSourceRows(c.env, user.id);

  const continueRows = await c.env.DB.prepare(
    `SELECT source_id, path, title, kind, position, duration, updated_at
       FROM progress
      WHERE user_id = ? AND finished = 0 AND position > 20
      ORDER BY updated_at DESC LIMIT 14`,
  )
    .bind(user.id)
    .all<{
      source_id: string;
      path: string;
      title: string;
      kind: string;
      position: number;
      duration: number;
      updated_at: number;
    }>();

  /**
   * A shelf's entries normally all belong to one source (`sourceId`). Continue
   * Watching and Favourites can span sources, so those carry a parallel
   * `sourceIds` array — index i of `entries` belongs to index i of `sourceIds`.
   * Without this, resuming an item from the second source would open it against
   * the first one.
   */
  interface HomeShelf {
    id: string;
    title: string;
    sourceId?: string;
    sourceIds?: string[];
    path?: string;
    entries: Entry[];
    resume?: Record<string, { position: number; duration: number }>;
  }

  const shelves: HomeShelf[] = [];

  if (continueRows.results?.length) {
    const resume: Record<string, { position: number; duration: number }> = {};
    const sourceIds: string[] = [];
    const entries: Entry[] = continueRows.results.map((r) => {
      resume[`${r.source_id}::${r.path}`] = { position: r.position, duration: r.duration };
      sourceIds.push(r.source_id);
      return {
        id: r.path,
        path: r.path,
        name: r.title,
        title: r.title,
        kind: r.kind === 'track' ? 'track' : 'video',
        art: null,
        subtitle: rows.find((s) => s.id === r.source_id)?.name ?? null,
        ext: extOf(r.path) || null,
      };
    });
    shelves.push({ id: 'continue', title: 'Continue Watching', entries, sourceIds, resume });
  }

  const favourites = await c.env.DB.prepare(
    `SELECT source_id, path, title, kind, art FROM favorites
      WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`,
  )
    .bind(user.id)
    .all<{ source_id: string; path: string; title: string; kind: string; art: string | null }>();

  if (favourites.results?.length) {
    shelves.push({
      id: 'favourites',
      title: 'Your Favourites',
      sourceIds: favourites.results.map((r) => r.source_id),
      entries: favourites.results.map((r) => ({
        id: r.path,
        path: r.path,
        name: r.title,
        title: r.title,
        kind: (r.kind as Entry['kind']) ?? 'video',
        art: r.art,
        subtitle: rows.find((s) => s.id === r.source_id)?.name ?? null,
      })),
    });
  }

  const sourceShelves = await Promise.allSettled(
    rows.map(async (row) => {
      const creds = await unseal<Credentials>(vault, row.secret_blob);
      const ctx = contextFromRow(row, creds);
      const adapter = adapterFor(ctx.kind);

      if (adapter.shelves) {
        const built = await adapter.shelves(ctx);
        if (built.length) {
          return built.map((s) => ({
            id: s.id,
            title: `${s.title} · ${row.name}`,
            sourceId: row.id,
            path: s.path,
            entries: s.entries,
          }));
        }
      }
      const entries = await adapter.list(ctx, '/');
      return [
        {
          id: `${row.id}:root`,
          title: row.name,
          sourceId: row.id,
          path: '/',
          entries: entries.slice(0, 24),
        },
      ];
    }),
  );

  const problems: { sourceId: string; name: string; message: string }[] = [];
  sourceShelves.forEach((r, i) => {
    if (r.status === 'fulfilled') shelves.push(...r.value);
    else {
      problems.push({
        sourceId: rows[i].id,
        name: rows[i].name,
        message: r.reason instanceof Error ? r.reason.message : 'Unavailable right now.',
      });
    }
  });

  return c.json({ shelves, problems, sourceCount: rows.length });
});

/* ------------------------- streaming & artwork ----------------------- */

const MIME: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska',
  mov: 'video/quicktime', ts: 'video/mp2t', m2ts: 'video/mp2t', ogv: 'video/ogg',
  m3u8: 'application/vnd.apple.mpegurl', avi: 'video/x-msvideo',
  mp3: 'audio/mpeg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac',
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav',
  wv: 'audio/x-wavpack', aiff: 'audio/aiff', srt: 'text/plain; charset=utf-8',
  vtt: 'text/vtt; charset=utf-8',
};

/** Headers worth passing back; everything else (cookies, CORS) is dropped. */
const PASSTHROUGH = [
  'content-length',
  'content-range',
  'accept-ranges',
  'etag',
  'last-modified',
];

api.on(['GET', 'HEAD'], '/stream', requireAuth, async (c) => {
  const sourceId = c.req.query('src');
  const path = c.req.query('path');
  if (!sourceId || !path) throw new HTTPException(400, { message: 'Missing src or path.' });

  const vault = await getVault(c);
  const ctx = await loadContext(c.env, vault, c.get('user').id, sourceId);

  let target;
  try {
    target = await adapterFor(ctx.kind).stream(ctx, normalisePath(path));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not open that file.';
    await noteSourceHealth(c.env, ctx.id, message);
    throw new HTTPException(502, { message });
  }

  // When the storage provider hands back its own signed CDN URL, send the
  // browser straight there. Large video then never transits this Worker.
  if (target.redirectable && c.req.query('proxy') !== '1') {
    return c.redirect(target.url, 302);
  }

  const range = c.req.header('range');
  const upstream = await fetch(target.url, {
    method: c.req.method === 'HEAD' ? 'HEAD' : 'GET',
    headers: {
      ...target.headers,
      ...(range ? { Range: range } : {}),
      // Some providers refuse requests without a UA.
      'User-Agent': 'HearthTV/1.0',
    },
    redirect: 'follow',
  });

  if (upstream.status === 401 || upstream.status === 403) {
    throw new HTTPException(502, {
      message: `“${ctx.name}” refused access to that file. Re-check the source credentials.`,
    });
  }
  if (upstream.status === 404) throw new HTTPException(404, { message: 'That file is gone.' });
  if (!upstream.ok && upstream.status !== 206) {
    throw new HTTPException(502, { message: `Storage responded ${upstream.status}.` });
  }

  const headers = new Headers();
  for (const h of PASSTHROUGH) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }

  // Trust our own extension mapping over the storage server's guess: NAS
  // boxes routinely label .mkv as application/octet-stream, which stops
  // <video> from even trying to play it.
  const ext = extOf(target.filename ?? path);
  const mapped = MIME[ext];
  headers.set('content-type', mapped ?? upstream.headers.get('content-type') ?? 'application/octet-stream');
  if (!headers.has('accept-ranges')) headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'private, max-age=0, no-store');

  return new Response(c.req.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
});

api.get('/art', requireAuth, async (c) => {
  const sourceId = c.req.query('src');
  const ref = c.req.query('ref');
  const size = Math.min(1024, Math.max(64, Number(c.req.query('size')) || 512));
  if (!sourceId || !ref) throw new HTTPException(400, { message: 'Missing src or ref.' });

  const vault = await getVault(c);
  const ctx = await loadContext(c.env, vault, c.get('user').id, sourceId);
  const adapter = adapterFor(ctx.kind);
  if (!adapter.art) return c.body(null, 404);

  const target = await adapter.art(ctx, ref, size);
  if (!target) return c.body(null, 404);

  const upstream = await fetch(target.url, { headers: target.headers });
  if (!upstream.ok) return c.body(null, 404);

  const headers = new Headers();
  headers.set('content-type', upstream.headers.get('content-type') ?? 'image/jpeg');
  const len = upstream.headers.get('content-length');
  if (len) headers.set('content-length', len);
  // Cover art never changes; let the browser keep it for a day.
  headers.set('cache-control', 'private, max-age=86400, immutable');
  return new Response(upstream.body, { status: 200, headers });
});

/* ------------------------------ progress ----------------------------- */

api.get('/progress', requireAuth, async (c) => {
  const res = await c.env.DB.prepare(
    `SELECT source_id, path, title, kind, position, duration, finished, updated_at
       FROM progress WHERE user_id = ? ORDER BY updated_at DESC LIMIT 200`,
  )
    .bind(c.get('user').id)
    .all<Record<string, unknown>>();

  return c.json({
    progress: (res.results ?? []).map((r) => ({
      sourceId: r.source_id,
      path: r.path,
      title: r.title,
      kind: r.kind,
      position: r.position,
      duration: r.duration,
      finished: Boolean(r.finished),
      updatedAt: r.updated_at,
    })),
  });
});

api.put('/progress', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{
    sourceId?: string;
    path?: string;
    title?: string;
    kind?: string;
    position?: number;
    duration?: number;
  }>();

  if (!body.sourceId || !body.path) throw new HTTPException(400, { message: 'Missing sourceId or path.' });

  const position = Math.max(0, Number(body.position) || 0);
  const duration = Math.max(0, Number(body.duration) || 0);
  // Treat the last 45 seconds (or 97%) as "watched" so it leaves Continue Watching.
  const finished = duration > 0 && (position >= duration - 45 || position / duration >= 0.97) ? 1 : 0;

  await c.env.DB.prepare(
    `INSERT INTO progress (user_id, source_id, path, title, kind, position, duration, finished, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, source_id, path) DO UPDATE SET
       title = excluded.title, kind = excluded.kind, position = excluded.position,
       duration = excluded.duration, finished = excluded.finished, updated_at = excluded.updated_at`,
  )
    .bind(
      user.id,
      body.sourceId,
      normalisePath(body.path),
      (body.title ?? 'Untitled').slice(0, 300),
      body.kind === 'track' ? 'track' : 'video',
      position,
      duration,
      finished,
      Date.now(),
    )
    .run();

  return c.json({ ok: true, finished: Boolean(finished) });
});

api.delete('/progress', requireAuth, async (c) => {
  const user = c.get('user');
  const sourceId = c.req.query('src');
  const path = c.req.query('path');
  if (sourceId && path) {
    await c.env.DB.prepare('DELETE FROM progress WHERE user_id = ? AND source_id = ? AND path = ?')
      .bind(user.id, sourceId, normalisePath(path))
      .run();
  } else {
    await c.env.DB.prepare('DELETE FROM progress WHERE user_id = ?').bind(user.id).run();
  }
  return c.json({ ok: true });
});

/* ----------------------------- favourites ---------------------------- */

api.get('/favorites', requireAuth, async (c) => {
  const res = await c.env.DB.prepare(
    'SELECT source_id, path, title, kind, art, created_at FROM favorites WHERE user_id = ? ORDER BY created_at DESC',
  )
    .bind(c.get('user').id)
    .all<Record<string, unknown>>();
  return c.json({
    favorites: (res.results ?? []).map((r) => ({
      sourceId: r.source_id,
      path: r.path,
      title: r.title,
      kind: r.kind,
      art: r.art,
      createdAt: r.created_at,
    })),
  });
});

api.post('/favorites', requireAuth, async (c) => {
  const user = c.get('user');
  const b = await c.req.json<{
    sourceId?: string; path?: string; title?: string; kind?: string; art?: string | null;
  }>();
  if (!b.sourceId || !b.path) throw new HTTPException(400, { message: 'Missing sourceId or path.' });

  await c.env.DB.prepare(
    `INSERT INTO favorites (user_id, source_id, path, title, kind, art, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, source_id, path) DO UPDATE SET title = excluded.title, art = excluded.art`,
  )
    .bind(
      user.id,
      b.sourceId,
      normalisePath(b.path),
      (b.title ?? 'Untitled').slice(0, 300),
      b.kind ?? 'video',
      b.art ?? null,
      Date.now(),
    )
    .run();
  return c.json({ ok: true });
});

api.delete('/favorites', requireAuth, async (c) => {
  const sourceId = c.req.query('src');
  const path = c.req.query('path');
  if (!sourceId || !path) throw new HTTPException(400, { message: 'Missing src or path.' });
  await c.env.DB.prepare('DELETE FROM favorites WHERE user_id = ? AND source_id = ? AND path = ?')
    .bind(c.get('user').id, sourceId, normalisePath(path))
    .run();
  return c.json({ ok: true });
});

/* --------------------------- remote profiles ------------------------- */

async function loadRemoteProfiles(env: Env, userId: string): Promise<RemoteProfile[]> {
  const res = await env.DB.prepare(
    'SELECT id, name, driver, mapping, device_hint, updated_at FROM remote_profiles WHERE user_id = ? ORDER BY updated_at DESC',
  )
    .bind(userId)
    .all<{
      id: string; name: string; driver: string; mapping: string;
      device_hint: string | null; updated_at: number;
    }>();

  return (res.results ?? []).map((r) => {
    let mapping = {};
    try {
      mapping = JSON.parse(r.mapping);
    } catch {
      mapping = {};
    }
    return {
      id: r.id,
      name: r.name,
      driver: r.driver as RemoteProfile['driver'],
      mapping,
      deviceHint: r.device_hint,
      updatedAt: r.updated_at,
    };
  });
}

api.get('/remote/profiles', requireAuth, async (c) =>
  c.json({ profiles: await loadRemoteProfiles(c.env, c.get('user').id) }),
);

api.put('/remote/profiles', requireAuth, async (c) => {
  const user = c.get('user');
  const b = await c.req.json<Partial<RemoteProfile>>();
  if (!b.driver || typeof b.mapping !== 'object' || b.mapping === null) {
    throw new HTTPException(400, { message: 'A remote profile needs a driver and a mapping.' });
  }
  const id = b.id && /^[\w-]{4,64}$/.test(b.id) ? b.id : newId();
  const now = Date.now();

  await c.env.DB.prepare(
    `INSERT INTO remote_profiles (id, user_id, name, driver, mapping, device_hint, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, driver = excluded.driver,
       mapping = excluded.mapping, device_hint = excluded.device_hint, updated_at = excluded.updated_at`,
  )
    .bind(
      id,
      user.id,
      (b.name ?? 'My Remote').slice(0, 60),
      b.driver,
      JSON.stringify(b.mapping),
      b.deviceHint ?? null,
      now,
      now,
    )
    .run();

  return c.json({ profiles: await loadRemoteProfiles(c.env, user.id) });
});

api.delete('/remote/profiles/:id', requireAuth, async (c) => {
  await c.env.DB.prepare('DELETE FROM remote_profiles WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), c.get('user').id)
    .run();
  return c.json({ profiles: await loadRemoteProfiles(c.env, c.get('user').id) });
});

/* ------------------------- phone-as-remote pairing ------------------- */

api.post('/remote/session', requireAuth, async (c) => {
  const code = newPairingCode();
  const origin = new URL(c.req.url).origin;
  return c.json({
    code,
    // The phone page is part of the same SPA, so no extra deploy target.
    phoneUrl: `${origin}/remote/${code}`,
    socketUrl: `${origin.replace(/^http/, 'ws')}/api/remote/socket?code=${code}&role=tv`,
  });
});

/**
 * The TV end must be authenticated. The phone end is intentionally not: the
 * pairing code is the capability, which is what makes "scan and control"
 * possible without typing a password on a phone keyboard.
 */
api.get('/remote/socket', async (c) => {
  const code = (c.req.query('code') ?? '').toUpperCase();
  const role = c.req.query('role') === 'tv' ? 'tv' : 'phone';
  if (!isPairingCode(code)) throw new HTTPException(400, { message: 'Malformed pairing code.' });

  if (role === 'tv') {
    // Reuse the cookie check without the JSON 401 shape a socket cannot read.
    const handler = requireAuth;
    let authed = false;
    await handler(c, async () => {
      authed = true;
    });
    if (!authed) return new Response('Sign in on the TV first.', { status: 401 });
  }

  const id = c.env.REMOTE_ROOM.idFromName(`room:${code}`);
  const stub = c.env.REMOTE_ROOM.get(id);
  const url = new URL(c.req.url);
  url.searchParams.set('role', role);
  return stub.fetch(new Request(url.toString(), c.req.raw));
});

/* ------------------------------ mounting ----------------------------- */

// Registered before `app.route`, because Hono copies a sub-app's routes at the
// moment `route()` is called — anything added afterwards would be ignored.
api.all('*', (c) => c.json({ error: 'No such endpoint.' }, 404));

app.route('/api', api);

// Everything else is the SPA, served by Workers Static Assets.
app.all('*', async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  // Static Assets hands back an immutable Response. Middleware further out
  // (the security headers) needs to add to it, so re-wrap it as a mutable copy.
  return new Response(res.body, res);
});

/**
 * Exported so the self-hosted Node server in `server-node/` can mount exactly the
 * same routes. One route table, two runtimes.
 */
export { app };

export default {
  fetch: app.fetch,

  /** Nightly housekeeping. Wire up with a cron trigger if you want it. */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await pruneExpiredSessions(env);
  },
} satisfies ExportedHandler<Env>;
