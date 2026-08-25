#!/usr/bin/env node
/**
 * Runs the real source adapters against real servers.
 *
 * The mock server in `tools/mock-webdav.mjs` proves the parser handles awkward
 * XML; this proves the adapters work against actual OpenList and Navidrome
 * installs, including the things a mock never reproduces: unicode filenames,
 * signed CDN URLs, real CORS headers and byte-serving behaviour.
 *
 * Credentials are read from the environment so they are never written to disk:
 *
 *   OPENLIST_URL=http://192.168.3.148:5244 OPENLIST_USER=admin OPENLIST_PASS=… \
 *   NAVIDROME_URL=http://192.168.3.148:4533 NAVIDROME_USER=loop NAVIDROME_PASS=… \
 *   node tools/test-live-sources.mjs
 */

import { openlistAdapter } from '../shared/sources/openlist.ts';
import { subsonicAdapter } from '../shared/sources/subsonic.ts';

let failures = 0;
let checks = 0;

function check(label, ok, detail = '') {
  checks++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

function ctx(overrides) {
  return {
    id: 'live-probe',
    kind: overrides.kind,
    name: overrides.name,
    baseUrl: overrides.baseUrl,
    rootPath: overrides.rootPath ?? '/',
    media: overrides.media ?? 'both',
    creds: overrides.creds,
  };
}

/** Confirms a URL actually serves the bytes a media element would ask for. */
async function probeMedia(url, label) {
  const res = await fetch(url, { headers: { Range: 'bytes=0-63' } });
  const ok = res.status === 200 || res.status === 206;
  const type = res.headers.get('content-type') ?? '';
  const buf = new Uint8Array(await res.arrayBuffer());
  check(`${label}: serves bytes`, ok && buf.length > 0, `${res.status}, ${type}, ${buf.length}B`);
  check(
    `${label}: honours Range`,
    res.status === 206 || res.headers.get('accept-ranges') === 'bytes',
    res.status === 206 ? 'got 206' : `accept-ranges: ${res.headers.get('accept-ranges')}`,
  );
  return { type, head: buf };
}

/** Direct mode needs the server to allow the browser's origin. */
async function probeCors(baseUrl, path, method, label) {
  const origin = 'https://hearth-tv.example.workers.dev';
  const res = await fetch(new URL(path, baseUrl), {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': method,
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });
  const allow = res.headers.get('access-control-allow-origin');
  const ok = allow === '*' || allow === origin;
  check(`${label}: CORS allows a browser origin`, ok, `allow-origin: ${allow ?? 'absent'}`);
  return ok;
}

async function testOpenList() {
  const baseUrl = process.env.OPENLIST_URL;
  if (!baseUrl) {
    console.log('\nOpenList: skipped (set OPENLIST_URL)');
    return;
  }
  console.log(`\nOpenList — ${baseUrl}`);

  const c = ctx({
    kind: 'openlist',
    name: 'Live OpenList',
    baseUrl,
    creds: { username: process.env.OPENLIST_USER, password: process.env.OPENLIST_PASS },
  });

  await probeCors(baseUrl, '/api/fs/list', 'POST', 'OpenList');

  const message = await openlistAdapter.test(c);
  check('OpenList: test() connects', true, message);

  const root = await openlistAdapter.list(c, '/');
  check('OpenList: lists the root', root.length > 0, `${root.length} entries`);

  // Walk to the first playable file anywhere in the tree.
  let found = null;
  const queue = root.map((e) => e);
  let guard = 0;
  while (queue.length && !found && guard++ < 25) {
    const entry = queue.shift();
    if (entry.kind === 'video' || entry.kind === 'track') {
      found = entry;
      break;
    }
    if (entry.kind === 'folder') {
      const kids = await openlistAdapter.list(c, entry.path);
      queue.push(...kids);
    }
  }

  check('OpenList: found a playable file', Boolean(found), found ? found.path : 'none in 25 folders');
  if (!found) return;

  console.log(`        title: ${JSON.stringify(found.title)}`);
  console.log(`        path : ${JSON.stringify(found.path)}`);
  // A macOS screen recording contains U+202F; a naive path round-trip loses it.
  const exotic = [...found.path].some((ch) => ch.codePointAt(0) > 127);
  if (exotic) console.log('        note : path contains non-ASCII characters');

  const target = await openlistAdapter.stream(c, found.path);
  check('OpenList: resolves a stream URL', Boolean(target.url), target.url.slice(0, 90) + '…');
  check(
    'OpenList: stream needs no headers (playable by <video>)',
    Object.keys(target.headers).length === 0,
    `${Object.keys(target.headers).length} header(s)`,
  );

  const media = await probeMedia(target.url, 'OpenList stream');
  const isMp4 = new TextDecoder().decode(media.head.slice(4, 8)) === 'ftyp';
  check('OpenList: bytes look like real media', isMp4 || media.type.startsWith('video') || media.type.startsWith('audio'), media.type);
}

async function testNavidrome() {
  const baseUrl = process.env.NAVIDROME_URL;
  if (!baseUrl) {
    console.log('\nNavidrome: skipped (set NAVIDROME_URL)');
    return;
  }
  console.log(`\nNavidrome — ${baseUrl}`);

  const c = ctx({
    kind: 'navidrome',
    name: 'Live Navidrome',
    baseUrl,
    media: 'music',
    creds: { username: process.env.NAVIDROME_USER, password: process.env.NAVIDROME_PASS },
  });

  await probeCors(baseUrl, '/rest/ping', 'GET', 'Navidrome');

  const message = await subsonicAdapter.test(c);
  check('Navidrome: test() connects', true, message);

  const menu = await subsonicAdapter.list(c, '/');
  check('Navidrome: builds the top-level menu', menu.length >= 6, `${menu.length} entries`);

  const shelves = await subsonicAdapter.shelves(c);
  check('Navidrome: builds home shelves', shelves.length > 0, shelves.map((s) => s.title).join(', '));

  const albums = await subsonicAdapter.list(c, '/albums');
  check('Navidrome: lists albums', albums.length > 0, `${albums.length} albums`);
  if (!albums.length) return;

  const album = albums[0];
  console.log(`        album: ${JSON.stringify(album.title)} by ${album.artist ?? '?'}`);

  const tracks = await subsonicAdapter.list(c, album.path);
  check('Navidrome: lists album tracks', tracks.length > 0, `${tracks.length} tracks`);
  if (!tracks.length) return;

  const track = tracks[0];
  console.log(`        track: ${JSON.stringify(track.title)} (${track.ext}, ${track.duration}s)`);

  const target = await subsonicAdapter.stream(c, track.path);
  check(
    'Navidrome: stream needs no headers (playable by <audio>)',
    Object.keys(target.headers).length === 0,
    `${Object.keys(target.headers).length} header(s)`,
  );
  const media = await probeMedia(target.url, 'Navidrome stream');
  check('Navidrome: bytes look like audio', media.type.startsWith('audio'), media.type);

  // Cover art is what makes the Now Playing screen work.
  if (album.art) {
    const ref = album.art.match(/[?&]ref=([^&]+)/);
    if (ref) {
      const artTarget = await subsonicAdapter.art(c, decodeURIComponent(ref[1]), 512);
      const res = await fetch(artTarget.url);
      const type = res.headers.get('content-type') ?? '';
      check('Navidrome: serves cover art', res.ok && type.startsWith('image'), `${res.status}, ${type}`);
    }
  }

  const results = await subsonicAdapter.search(c, album.title.slice(0, 4));
  check('Navidrome: search returns results', results.length > 0, `${results.length} hits`);
}

console.log('Testing the real adapters against live servers');

try {
  await testOpenList();
  await testNavidrome();
} catch (err) {
  console.error('\nUnexpected failure:', err.message);
  failures++;
}

console.log(
  `\n${failures === 0 ? `All ${checks} live checks passed.` : `${failures} of ${checks} checks failed.`}`,
);
process.exit(failures === 0 ? 0 : 1);
