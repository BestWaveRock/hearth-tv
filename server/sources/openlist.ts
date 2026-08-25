import type { Entry } from '../../shared/types';
import {
  type Adapter,
  type SourceContext,
  type StreamTarget,
  baseName,
  classify,
  describeFile,
  extOf,
  fetchWithTimeout,
  isHidden,
  normalisePath,
  sortEntries,
} from './util';

/**
 * OpenList (and its predecessor Alist) aggregates dozens of cloud drives
 * behind one filesystem API. Its big advantage for a TV: `/api/fs/get`
 * returns a pre-signed `raw_url` on the provider's own CDN, so video bytes
 * can bypass this Worker entirely.
 */

interface AlistEnvelope<T> {
  code: number;
  message: string;
  data: T | null;
}

interface AlistItem {
  name: string;
  size: number;
  is_dir: boolean;
  modified?: string;
  created?: string;
  sign?: string;
  thumb?: string;
  type?: number;
}

interface AlistListData {
  content: AlistItem[] | null;
  total: number;
  readme?: string;
  provider?: string;
}

interface AlistGetData extends AlistItem {
  raw_url?: string;
  provider?: string;
}

/**
 * Login tokens are valid for ~48h. Caching them per isolate avoids a login
 * round trip on every listing; a cold isolate simply logs in again.
 */
const tokenCache = new Map<string, { token: string; expires: number }>();

function apiRoot(ctx: SourceContext): string {
  return ctx.baseUrl.replace(/\/+$/, '');
}

/** Resolves the source's logical path into an absolute path on the server. */
function serverPath(ctx: SourceContext, path: string): string {
  const root = normalisePath(ctx.rootPath);
  const rel = normalisePath(path);
  return normalisePath(root === '/' ? rel : root + rel);
}

async function login(ctx: SourceContext): Promise<string> {
  // A long-lived token from the admin panel is preferred: no login needed.
  if (ctx.creds.token) return ctx.creds.token;

  const cached = tokenCache.get(ctx.id);
  if (cached && cached.expires > Date.now()) return cached.token;

  if (!ctx.creds.username) {
    // Guest access: many OpenList instances allow anonymous browsing.
    return '';
  }

  const res = await fetchWithTimeout(`${apiRoot(ctx)}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: ctx.creds.username,
      password: ctx.creds.password ?? '',
    }),
  });

  if (!res.ok) throw new Error(`OpenList login failed with HTTP ${res.status}.`);

  const body = (await res.json()) as AlistEnvelope<{ token: string }>;
  if (body.code !== 200 || !body.data?.token) {
    throw new Error(body.message || 'OpenList rejected the username or password.');
  }

  // Refresh well before the server-side 48h expiry.
  tokenCache.set(ctx.id, { token: body.data.token, expires: Date.now() + 36 * 3600 * 1000 });
  return body.data.token;
}

async function post<T>(
  ctx: SourceContext,
  endpoint: string,
  payload: Record<string, unknown>,
  retrying = false,
): Promise<T> {
  const token = await login(ctx);
  const res = await fetchWithTimeout(`${apiRoot(ctx)}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: token } : {}),
    },
    body: JSON.stringify(payload),
  });

  if (res.status === 404) {
    throw new Error(
      'No OpenList API at that address. Use the site root, e.g. https://list.example.com',
    );
  }
  if (!res.ok) throw new Error(`OpenList responded ${res.status} ${res.statusText}`);

  const body = (await res.json()) as AlistEnvelope<T>;

  // 401 here means the cached token went stale; drop it and retry once.
  if ((body.code === 401 || body.code === 403) && !retrying && !ctx.creds.token) {
    tokenCache.delete(ctx.id);
    return post<T>(ctx, endpoint, payload, true);
  }

  if (body.code !== 200) {
    if (body.code === 401 || body.code === 403) {
      throw new Error('OpenList denied access — check the account or the folder password.');
    }
    if (body.code === 500 && /object not found/i.test(body.message)) {
      throw new Error('That folder does not exist on the OpenList server.');
    }
    throw new Error(body.message || `OpenList error ${body.code}`);
  }
  if (body.data === null) throw new Error('OpenList returned an empty response.');
  return body.data;
}

export const openlistAdapter: Adapter = {
  kind: 'openlist',

  async list(ctx, path) {
    const data = await post<AlistListData>(ctx, '/api/fs/list', {
      path: serverPath(ctx, path),
      password: '',
      page: 1,
      per_page: 0, // 0 means "everything"
      refresh: false,
    });

    const here = normalisePath(path);
    const entries: Entry[] = [];

    for (const item of data.content ?? []) {
      if (!item.name || isHidden(item.name)) continue;

      const kind = classify(item.name, item.is_dir);
      if (!item.is_dir && (kind === 'other' || kind === 'image')) continue;
      if (ctx.media === 'music' && kind === 'video') continue;
      if (ctx.media === 'video' && kind === 'track') continue;

      const childPath = normalisePath(`${here}/${item.name}`);
      const { title, year, episode } = describeFile(item.name, item.is_dir);

      entries.push({
        id: childPath,
        path: childPath,
        name: item.name,
        title: episode ? `${episode} · ${title}` : title,
        kind,
        size: item.size || undefined,
        mtime: item.modified ? Date.parse(item.modified) || undefined : undefined,
        year,
        ext: item.is_dir ? null : extOf(item.name),
        subtitle: episode,
        // OpenList thumbnails are already absolute and publicly signed.
        art: item.thumb ? item.thumb : null,
      });
    }

    return sortEntries(entries);
  },

  async stream(ctx, path): Promise<StreamTarget> {
    const data = await post<AlistGetData>(ctx, '/api/fs/get', {
      path: serverPath(ctx, path),
      password: '',
    });

    if (!data.raw_url) throw new Error('OpenList did not return a download URL for that file.');

    let redirectable = false;
    try {
      redirectable = new URL(data.raw_url).host !== new URL(ctx.baseUrl).host;
    } catch {
      redirectable = false;
    }

    return {
      url: data.raw_url,
      headers: {},
      redirectable,
      filename: baseName(path),
    };
  },

  async test(ctx) {
    const data = await post<AlistListData>(ctx, '/api/fs/list', {
      path: serverPath(ctx, '/'),
      password: '',
      page: 1,
      per_page: 0,
      refresh: false,
    });
    const n = data.content?.length ?? 0;
    return `Connected${data.provider ? ` via ${data.provider}` : ''}. ${n} item${n === 1 ? '' : 's'} at the root.`;
  },

  async search(ctx, query) {
    // OpenList has a real index, but only when the admin has enabled it.
    try {
      const data = await post<{ content: { parent: string; name: string; is_dir: boolean; size: number }[] | null }>(
        ctx,
        '/api/fs/search',
        {
          parent: serverPath(ctx, '/'),
          keywords: query,
          scope: 0,
          page: 1,
          per_page: 60,
          password: '',
        },
      );

      const root = normalisePath(ctx.rootPath);
      return (data.content ?? [])
        .filter((r) => !isHidden(r.name))
        .map((r) => {
          let logical = normalisePath(`${r.parent}/${r.name}`);
          if (root !== '/' && logical.startsWith(root)) logical = normalisePath(logical.slice(root.length));
          const kind = classify(r.name, r.is_dir);
          const { title, year } = describeFile(r.name, r.is_dir);
          return {
            id: logical,
            path: logical,
            name: r.name,
            title,
            kind,
            size: r.size || undefined,
            year,
            ext: r.is_dir ? null : extOf(r.name),
            art: null,
            subtitle: normalisePath(r.parent),
          } satisfies Entry;
        })
        .filter((e) => e.kind !== 'other' && e.kind !== 'image');
    } catch {
      // Index disabled — return nothing rather than crawling a cloud drive.
      return [];
    }
  },
};
