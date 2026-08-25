/**
 * Static asset serving for the self-hosted server.
 *
 * On Cloudflare this is the `ASSETS` binding. Here it reads the built SPA off
 * disk behind the same `fetch(Request) -> Response` interface, so the route table
 * in `server/index.ts` does not need to know which runtime it is on.
 *
 * A pleasant side effect of routing assets through Hono in this deployment: the
 * `secureHeaders()` middleware applies to the HTML document too, which on
 * Cloudflare requires a separate `public/_headers` file because the asset server
 * answers before the Worker runs.
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export interface AssetServer {
  fetch(request: Request): Promise<Response>;
}

export function createAssetServer(rootDir: string): AssetServer {
  const root = resolve(rootDir);

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      let pathname: string;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        pathname = url.pathname;
      }

      const file = resolveSafe(root, pathname);

      // Real asset.
      if (file && isFile(file)) return send(file, request);

      // Single-page-application fallback, matching the Cloudflare config.
      const indexHtml = join(root, 'index.html');
      if (isFile(indexHtml)) {
        const body = await readFile(indexHtml);
        return new Response(body, {
          status: 200,
          headers: {
            'content-type': MIME['.html'],
            // The shell must never be cached, or a deploy leaves stale asset refs.
            'cache-control': 'no-cache',
          },
        });
      }

      return new Response(
        'The interface has not been built yet. Run `npm run build`, or use the published container image.',
        { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } },
      );
    },
  };
}

/**
 * Resolves a request path inside the asset root, refusing anything that escapes
 * it. Without this, `GET /../../etc/passwd` would be served happily.
 */
function resolveSafe(root: string, pathname: string): string | null {
  const candidate = resolve(join(root, normalize(pathname)));
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;
  return candidate;
}

function isFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Serves a file, honouring Range so large assets stream properly. */
function send(path: string, request: Request): Response {
  const stat = statSync(path);
  const type = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';

  // Hashed bundles are immutable; everything else revalidates.
  const immutable = /\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\.[a-z]+$/.test(path);
  const cacheControl = immutable ? 'public, max-age=31536000, immutable' : 'no-cache';

  const range = request.headers.get('range');
  const match = range?.match(/bytes=(\d*)-(\d*)/);

  if (match) {
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    if (start > end || start >= stat.size) {
      return new Response(null, {
        status: 416,
        headers: { 'content-range': `bytes */${stat.size}` },
      });
    }
    // Node's web ReadableStream and the one workers-types declares are structurally
    // near-identical but not assignable; the double cast is the honest way to say
    // "these are the same object at runtime".
    const stream = Readable.toWeb(createReadStream(path, { start, end })) as unknown as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: {
        'content-type': type,
        'content-length': String(end - start + 1),
        'content-range': `bytes ${start}-${end}/${stat.size}`,
        'accept-ranges': 'bytes',
        'cache-control': cacheControl,
      },
    });
  }

  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: {
        'content-type': type,
        'content-length': String(stat.size),
        'accept-ranges': 'bytes',
        'cache-control': cacheControl,
      },
    });
  }

  const stream = Readable.toWeb(createReadStream(path)) as unknown as ReadableStream;
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': type,
      'content-length': String(stat.size),
      'accept-ranges': 'bytes',
      'cache-control': cacheControl,
    },
  });
}
