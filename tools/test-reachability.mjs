#!/usr/bin/env node
/**
 * Reachability rule tests.
 *
 * These encode the browser's mixed-content rules and Cloudflare's routing
 * limits. Getting them wrong means telling a user the wrong reason their NAS
 * will not connect, which is worse than saying nothing, so every branch is
 * pinned here.
 *
 * Usage:  node tools/test-reachability.mjs
 */

import {
  directModeBlocker,
  isPrivateHost,
  isTrustworthyHttp,
  proxyModeBlocker,
  suggestAccessMode,
  supportsDirect,
} from '../shared/sources/reachability.ts';

let failures = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}`);
  if (!ok) {
    console.log(`        expected ${JSON.stringify(expected)}`);
    console.log(`        got      ${JSON.stringify(actual)}`);
    failures++;
  }
}

const HOSTED = 'https://hearth-tv.example.workers.dev';
const LOCAL = 'http://localhost:5173';

console.log('\nPrivate host detection');
for (const host of [
  '192.168.1.50', '10.0.0.5', '172.16.0.1', '172.31.255.254',
  '127.0.0.1', 'localhost', 'nas.local', 'box.internal', 'thing.home.arpa',
  '::1', 'fd00::1', 'fe80::1', '100.100.5.5', '169.254.1.1',
]) {
  check(`${host} is private`, isPrivateHost(host), true);
}
for (const host of [
  'example.com', 'nas.example.com', '8.8.8.8', '172.32.0.1', '172.15.0.1',
  '100.5.5.5', '11.0.0.1',
]) {
  check(`${host} is public`, isPrivateHost(host), false);
}

console.log('\nMixed-content exemptions (loopback only)');
check('localhost is exempt', isTrustworthyHttp('localhost'), true);
check('127.0.0.1 is exempt', isTrustworthyHttp('127.0.0.1'), true);
check('::1 is exempt', isTrustworthyHttp('::1'), true);
// This is the crucial one: a LAN IP is NOT exempt, however "local" it feels.
check('192.168.1.50 is NOT exempt', isTrustworthyHttp('192.168.1.50'), false);
check('nas.local is NOT exempt', isTrustworthyHttp('nas.local'), false);

console.log('\nDirect mode from the hosted https site');
check(
  'plain-http LAN address is blocked as mixed content',
  directModeBlocker(HOSTED, 'http://192.168.1.50:5244', 'openlist'),
  { code: 'mixed-content', host: '192.168.1.50', pageOrigin: 'https://hearth-tv.example.workers.dev' },
);
check(
  'http on loopback is allowed',
  directModeBlocker(HOSTED, 'http://127.0.0.1:5244', 'openlist'),
  null,
);
check(
  'https LAN address is allowed',
  directModeBlocker(HOSTED, 'https://nas.example.com', 'navidrome'),
  null,
);
check(
  'https on a private IP is allowed (a real cert can exist for it)',
  directModeBlocker(HOSTED, 'https://192.168.1.50:5244', 'openlist'),
  null,
);
check(
  'WebDAV cannot do direct mode at all',
  directModeBlocker(HOSTED, 'https://dav.example.com', 'webdav'),
  { code: 'kind-unsupported', kind: 'webdav' },
);
check(
  'a malformed address is reported as such',
  directModeBlocker(HOSTED, 'not a url', 'openlist'),
  { code: 'bad-url', detail: 'not a url' },
);

console.log('\nDirect mode from a local dev server (http page)');
check(
  'http page may reach a plain-http LAN address',
  directModeBlocker(LOCAL, 'http://192.168.1.50:5244', 'openlist'),
  null,
);

console.log('\nProxy mode');
check(
  'LAN address is unreachable from Cloudflare',
  proxyModeBlocker(HOSTED, 'http://192.168.1.50:5244'),
  { code: 'private-from-cloud', host: '192.168.1.50' },
);
check(
  'public address is fine',
  proxyModeBlocker(HOSTED, 'https://music.example.com'),
  null,
);
check(
  'during local development the LAN restriction does not apply',
  proxyModeBlocker(LOCAL, 'http://192.168.1.50:5244'),
  null,
);

console.log('\nMode suggestion');
check(
  'a LAN address suggests direct',
  suggestAccessMode('http://192.168.1.50:5244', 'openlist'),
  'direct',
);
check(
  'a public address suggests proxy',
  suggestAccessMode('https://list.example.com', 'openlist'),
  'proxy',
);
check(
  'WebDAV always suggests proxy',
  suggestAccessMode('http://192.168.1.50/dav', 'webdav'),
  'proxy',
);

console.log(
  `\n${failures === 0 ? 'All reachability checks passed.' : `${failures} check(s) failed.`}`,
);
process.exit(failures === 0 ? 0 : 1);
