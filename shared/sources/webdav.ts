import type { Entry } from '../types.ts';
import { basicAuth } from './crypto.ts';
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
  joinUrl,
  normalisePath,
  sortEntries,
} from './util.ts';

/* ------------------------------------------------------------------ *
 * A namespace-agnostic XML reader.
 *
 * The Workers runtime has no DOMParser and HTMLRewriter cannot parse the
 * `D:multistatus` documents WebDAV returns. Every server also picks its own
 * namespace prefix (`d:`, `D:`, `lp1:`, `ns0:`), so tags are matched with the
 * prefix treated as optional.
 * ------------------------------------------------------------------ */

const PREFIX = '(?:[A-Za-z0-9_.-]+:)?';

function blocksOf(xml: string, tag: string): string[] {
  const re = new RegExp(
    `<${PREFIX}${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${PREFIX}${tag}\\s*>`,
    'gi',
  );
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function textOf(xml: string, tag: string): string | null {
  const re = new RegExp(`<${PREFIX}${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${PREFIX}${tag}\\s*>`, 'i');
  const m = xml.match(re);
  return m ? decodeXml(m[1].trim()) : null;
}

/** True for both `<d:collection/>` and `<d:collection></d:collection>`. */
function hasTag(xml: string, tag: string): boolean {
  return new RegExp(`<${PREFIX}${tag}(?:\\s[^>]*)?\\s*\\/?>`, 'i').test(xml);
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:displayname/>
    <d:getcontentlength/>
    <d:getlastmodified/>
    <d:getcontenttype/>
    <d:resourcetype/>
  </d:prop>
</d:propfind>`;

function authHeaders(ctx: SourceContext): Record<string, string> {
  const h: Record<string, string> = {};
  if (ctx.creds.token) h['Authorization'] = `Bearer ${ctx.creds.token}`;
  else if (ctx.creds.username) {
    h['Authorization'] = basicAuth(ctx.creds.username, ctx.creds.password ?? '');
  }
  return h;
}

function absoluteUrl(ctx: SourceContext, path: string): string {
  return joinUrl(ctx.baseUrl, ctx.rootPath, path);
}

/** The decoded URL path that all `href` values are relative to. */
function rootPrefix(ctx: SourceContext): string {
  const u = new URL(joinUrl(ctx.baseUrl, ctx.rootPath) + '/');
  return decodeURIComponent(u.pathname).replace(/\/+$/, '');
}

/**
 * `href` may be absolute (`https://host/dav/a%20b/`) or root-relative
 * (`/dav/a%20b/`), and is always percent-encoded. Convert it back into a
 * source-relative logical path.
 */
function hrefToPath(ctx: SourceContext, href: string): string | null {
  let pathname = href;
  if (/^https?:\/\//i.test(href)) {
    try {
      pathname = new URL(href).pathname;
    } catch {
      return null;
    }
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    decoded = pathname;
  }
  decoded = decoded.replace(/\/+$/, '');

  const prefix = rootPrefix(ctx);
  if (prefix && decoded.toLowerCase().startsWith(prefix.toLowerCase())) {
    decoded = decoded.slice(prefix.length);
  }
  return normalisePath(decoded || '/');
}

export const webdavAdapter: Adapter = {
  kind: 'webdav',

  async list(ctx, path) {
    const url = absoluteUrl(ctx, path);
    const res = await fetchWithTimeout(url.endsWith('/') ? url : url + '/', {
      method: 'PROPFIND',
      headers: {
        ...authHeaders(ctx),
        Depth: '1',
        'Content-Type': 'application/xml; charset=utf-8',
        Accept: 'application/xml,text/xml',
      },
      body: PROPFIND_BODY,
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error('WebDAV rejected the credentials for this source.');
    }
    if (res.status === 404) throw new Error(`Folder not found on the WebDAV server: ${path}`);
    if (res.status === 405) {
      throw new Error(
        'The server refused PROPFIND. Check that the URL points at a WebDAV endpoint (for Nextcloud this is /remote.php/dav/files/<user>).',
      );
    }
    if (!res.ok) throw new Error(`WebDAV responded ${res.status} ${res.statusText}`);

    const xml = await res.text();
    const self = normalisePath(path);
    const entries: Entry[] = [];

    for (const block of blocksOf(xml, 'response')) {
      const href = textOf(block, 'href');
      if (!href) continue;

      const itemPath = hrefToPath(ctx, href);
      // Depth:1 always echoes the collection itself back; skip it.
      if (itemPath === null || itemPath === self) continue;

      const isDir = hasTag(block, 'collection');
      const name = textOf(block, 'displayname') || baseName(itemPath);
      if (!name || isHidden(name)) continue;

      const kind = classify(name, isDir);
      if (kind === 'other' || kind === 'image') {
        // Keep the listing to things a TV can actually play.
        if (!isDir) continue;
      }
      if (ctx.media === 'music' && kind === 'video') continue;
      if (ctx.media === 'video' && kind === 'track') continue;

      const sizeText = textOf(block, 'getcontentlength');
      const mtimeText = textOf(block, 'getlastmodified');
      const { title, year, episode } = describeFile(name, isDir);

      entries.push({
        id: itemPath,
        path: itemPath,
        name,
        title: episode ? `${episode} · ${title}` : title,
        kind,
        size: sizeText ? Number(sizeText) : undefined,
        mtime: mtimeText ? Date.parse(mtimeText) || undefined : undefined,
        year,
        ext: isDir ? null : extOf(name),
        subtitle: episode,
        art: null,
      });
    }

    return sortEntries(entries);
  },

  async stream(ctx, path): Promise<StreamTarget> {
    return {
      url: absoluteUrl(ctx, path),
      headers: authHeaders(ctx),
      filename: baseName(path),
    };
  },

  async test(ctx) {
    const entries = await webdavAdapter.list(ctx, '/');
    return `Connected. ${entries.length} item${entries.length === 1 ? '' : 's'} visible at the root.`;
  },

  /**
   * WebDAV has no search verb that is portable across servers, so this walks
   * the tree breadth-first with a hard budget. Bounded, but honest about it.
   */
  async search(ctx, query) {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];

    const results: Entry[] = [];
    const queue: string[] = ['/'];
    let visited = 0;

    while (queue.length && visited < 40 && results.length < 60) {
      const dir = queue.shift()!;
      visited++;
      let entries: Entry[];
      try {
        entries = await webdavAdapter.list(ctx, dir);
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.name.toLowerCase().includes(needle)) results.push(e);
        if (e.kind === 'folder' && queue.length < 200) queue.push(e.path);
      }
    }
    return results;
  },
};
