#!/usr/bin/env node
/**
 * End-to-end test of Direct mode, following the browser's code path exactly.
 *
 * `src/lib/direct.ts` does three things: ask the Hearth API for the stored
 * credentials, drive the shared adapter with them, and rewrite artwork URLs. This
 * reproduces that sequence against a running self-hosted server, so the
 * integration between the credential endpoint, the adapters and the real storage
 * servers is proven rather than assumed.
 *
 * Usage:  node tools/test-direct-e2e.mjs [baseUrl] [cookieFile]
 */

import { readFileSync } from 'node:fs';
import { openlistAdapter } from '../shared/sources/openlist.ts';
import { subsonicAdapter } from '../shared/sources/subsonic.ts';
import { directModeBlocker } from '../shared/sources/reachability.ts';

const BASE = process.argv[2] ?? 'http://localhost:8790';
const COOKIE_FILE = process.argv[3] ?? '/tmp/lk.txt';

const ADAPTERS = { openlist: openlistAdapter, navidrome: subsonicAdapter };

let failures = 0;
let checks = 0;
function check(label, ok, detail = '') {
  checks++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

function cookie() {
  const jar = readFileSync(COOKIE_FILE, 'utf8');
  const line = jar.split('\n').find((l) => l.includes('hearth_sid'));
  if (!line) throw new Error(`No session cookie in ${COOKIE_FILE}`);
  const parts = line.split('\t');
  return `hearth_sid=${parts[parts.length - 1].trim()}`;
}

const COOKIE = cookie();
const authed = (path, init = {}) =>
  fetch(BASE + path, { ...init, headers: { cookie: COOKIE, ...(init.headers ?? {}) } });

async function main() {
  console.log(`Direct-mode end-to-end against ${BASE}\n`);

  const { sources } = await (await authed('/api/sources')).json();
  const direct = sources.filter((s) => s.access === 'direct');
  check('server reports direct-mode sources', direct.length > 0, `${direct.length} of ${sources.length}`);

  for (const source of direct) {
    console.log(`\n${source.name}  (${source.kind} → ${source.baseUrl})`);

    // The browser would refuse before any request if the page is https and the
    // target is plain http. Served over http locally, it must be allowed.
    const blocker = directModeBlocker(BASE, source.baseUrl, source.kind);
    check('reachable from this page origin', blocker === null, blocker ? blocker.code : 'no blocker');

    // 1. Credentials, exactly as the browser fetches them.
    const credRes = await authed(`/api/sources/${source.id}/credentials`);
    check('credential endpoint allows a direct source', credRes.ok, `HTTP ${credRes.status}`);
    check(
      'credentials are not cacheable',
      (credRes.headers.get('cache-control') ?? '').includes('no-store'),
      credRes.headers.get('cache-control') ?? 'absent',
    );
    if (!credRes.ok) continue;
    const { credentials } = await credRes.json();
    check('credentials contain a secret', Boolean(credentials.password || credentials.token));

    const ctx = {
      id: source.id,
      kind: source.kind,
      name: source.name,
      baseUrl: source.baseUrl,
      rootPath: source.rootPath,
      media: source.media,
      creds: credentials,
    };
    const adapter = ADAPTERS[source.kind];

    // 2. Listing, straight from the storage server.
    const entries = await adapter.list(ctx, '/');
    check('lists the root directly', entries.length > 0, `${entries.length} entries`);

    // 3. Find something playable and resolve a real media URL.
    let playable = null;
    const queue = [...entries];
    let guard = 0;
    while (queue.length && !playable && guard++ < 30) {
      const entry = queue.shift();
      if (entry.kind === 'video' || entry.kind === 'track') playable = entry;
      else if (['folder', 'album', 'artist', 'playlist'].includes(entry.kind)) {
        try {
          queue.push(...(await adapter.list(ctx, entry.path)));
        } catch {
          /* skip unreadable branch */
        }
      }
    }
    check('found something playable', Boolean(playable), playable?.path ?? 'none');
    if (!playable) continue;
    console.log(`        ${JSON.stringify(playable.title)}  (${playable.kind}, ${playable.ext ?? '?'})`);

    const target = await adapter.stream(ctx, playable.path);
    check(
      'stream URL needs no headers, so <video> can load it',
      Object.keys(target.headers).length === 0,
    );
    check('stream URL points at the storage server, not Hearth', !target.url.startsWith(BASE), new URL(target.url).host);

    // 4. Fetch the first bytes the way a media element would.
    const media = await fetch(target.url, { headers: { Range: 'bytes=0-2047' } });
    const type = media.headers.get('content-type') ?? '';
    const bytes = new Uint8Array(await media.arrayBuffer());
    check(
      'media bytes arrive',
      (media.status === 206 || media.status === 200) && bytes.length > 0,
      `${media.status}, ${type}, ${bytes.length}B`,
    );
    check('content type is playable media', /^(video|audio)\//.test(type), type);

    // 5. Artwork, which is what the Now Playing screen needs.
    const withArt = entries.find((e) => e.art) ?? playable;
    if (withArt?.art && adapter.art) {
      const ref = withArt.art.match(/[?&]ref=([^&]+)/);
      if (ref) {
        const artTarget = await adapter.art(ctx, decodeURIComponent(ref[1]), 512);
        const artRes = await fetch(artTarget.url);
        check(
          'artwork resolves against the storage server',
          artRes.ok && (artRes.headers.get('content-type') ?? '').startsWith('image'),
          `${artRes.status}, ${artRes.headers.get('content-type')}`,
        );
      }
    }
  }

  // Proxy-mode sources must never leak credentials.
  const proxy = sources.filter((s) => s.access === 'proxy');
  if (proxy.length) {
    const res = await authed(`/api/sources/${proxy[0].id}/credentials`);
    check('proxy-mode credentials stay on the server', res.status === 403, `HTTP ${res.status}`);
  }

  console.log(
    `\n${failures === 0 ? `All ${checks} direct-mode checks passed.` : `${failures} of ${checks} failed.`}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
