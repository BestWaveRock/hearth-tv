#!/usr/bin/env node
/**
 * A deliberately awkward mock WebDAV server, used to exercise the XML reader in
 * `server/sources/webdav.ts` during development.
 *
 * The Workers runtime has no DOMParser, so that reader is regex-based, which
 * makes it the single most fragile piece of the project. Real WebDAV servers
 * differ in ways that break naive parsers, so this mock reproduces the nastiest
 * of them all at once:
 *
 *   - three different namespace prefixes in one document (D:, lp1:, ns0:)
 *   - percent-encoded hrefs containing spaces, brackets and CJK characters
 *   - absolute hrefs for some entries, root-relative for others
 *   - self-closing <collection/> as well as the paired form
 *   - a display name wrapped in CDATA
 *   - XML entities in a filename
 *   - a hidden dotfile and a .nfo, which must both be filtered out
 *
 * Usage:  node tools/mock-webdav.mjs [port]
 */

import { createServer } from 'node:http';

const PORT = Number(process.argv[2] ?? 4918);
const ROOT = '/dav';

/** path -> { dir, children } */
const TREE = {
  '/': {
    dir: true,
    children: [
      { name: 'Films', dir: true },
      { name: 'Shows', dir: true },
      { name: 'The Quiet Hours (2019) [1080p].mkv', dir: false, size: 8123456789 },
      { name: 'Sunset & Rain.mp4', dir: false, size: 1240000000 },
      { name: '春天的故事.mp4', dir: false, size: 990000000 },
      { name: '.hidden-thing', dir: false, size: 12 },
      { name: 'notes.nfo', dir: false, size: 900 },
      { name: 'archive.zip', dir: false, size: 5000 },
    ],
  },
  '/Films': {
    dir: true,
    children: [
      { name: 'Autumn.Light.2021.2160p.WEB-DL.x265-GRP.mkv', dir: false, size: 20e9 },
      { name: 'cover.jpg', dir: false, size: 40000 },
    ],
  },
  '/Shows': {
    dir: true,
    children: [{ name: 'Season 1', dir: true }],
  },
  '/Shows/Season 1': {
    dir: true,
    children: [
      { name: 'Show.S01E02.The.Long.Walk.1080p.mkv', dir: false, size: 3e9 },
      { name: 'Show.S01E10.Finale.1080p.mkv', dir: false, size: 3e9 },
      { name: 'Show.S01E01.Pilot.1080p.mkv', dir: false, size: 3e9 },
    ],
  },
};

const xmlEscape = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Percent-encode a path segment the way a real server does. */
const encodeSeg = (s) => encodeURIComponent(s);

function propfindBody(requestPath, host) {
  const node = TREE[requestPath];
  if (!node) return null;

  const responses = [];

  // The collection itself, always echoed back at Depth: 1.
  responses.push(`
  <D:response>
    <D:href>${ROOT}${requestPath.split('/').map(encodeSeg).join('/')}/</D:href>
    <D:propstat>
      <lp1:prop>
        <lp1:displayname>${xmlEscape(requestPath)}</lp1:displayname>
        <lp1:resourcetype><D:collection/></lp1:resourcetype>
        <lp1:getlastmodified>Mon, 12 Aug 2024 09:00:00 GMT</lp1:getlastmodified>
      </lp1:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`);

  node.children.forEach((child, i) => {
    const base = requestPath === '/' ? '' : requestPath;
    const childPath = `${base}/${child.name}`;
    const encoded = childPath.split('/').map(encodeSeg).join('/');

    // Alternate between absolute and root-relative hrefs, and rotate namespace
    // prefixes, exactly as a mixed fleet of servers would.
    const href = i % 2 === 0 ? `${ROOT}${encoded}` : `http://${host}${ROOT}${encoded}`;
    const prefix = i % 3 === 0 ? 'D' : i % 3 === 1 ? 'lp1' : 'ns0';

    const displayName =
      i % 4 === 0
        ? `<${prefix}:displayname><![CDATA[${child.name}]]></${prefix}:displayname>`
        : `<${prefix}:displayname>${xmlEscape(child.name)}</${prefix}:displayname>`;

    const resourceType = child.dir
      ? i % 2 === 0
        ? `<${prefix}:resourcetype><D:collection/></${prefix}:resourcetype>`
        : `<${prefix}:resourcetype><D:collection></D:collection></${prefix}:resourcetype>`
      : `<${prefix}:resourcetype/>`;

    responses.push(`
  <D:response>
    <D:href>${href}${child.dir ? '/' : ''}</D:href>
    <D:propstat>
      <${prefix}:prop>
        ${displayName}
        ${resourceType}
        ${child.dir ? '' : `<${prefix}:getcontentlength>${child.size}</${prefix}:getcontentlength>`}
        <${prefix}:getlastmodified>Tue, 13 Aug 2024 11:22:33 GMT</${prefix}:getlastmodified>
      </${prefix}:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`);
  });

  return `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:lp1="DAV:" xmlns:ns0="DAV:">${responses.join('')}
</D:multistatus>`;
}

const server = createServer((req, res) => {
  const auth = req.headers.authorization ?? '';
  const expected = 'Basic ' + Buffer.from('demo:secret').toString('base64');

  if (auth !== expected) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="mock"' });
    res.end('unauthorised');
    console.log(`401 ${req.method} ${req.url}`);
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  let path = decodeURIComponent(url.pathname);
  if (!path.startsWith(ROOT)) {
    res.writeHead(404).end('not found');
    return;
  }
  path = path.slice(ROOT.length).replace(/\/+$/, '') || '/';

  if (req.method === 'PROPFIND') {
    const body = propfindBody(path, req.headers.host);
    if (!body) {
      res.writeHead(404).end('not found');
      console.log(`404 PROPFIND ${path}`);
      return;
    }
    res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
    res.end(body);
    console.log(`207 PROPFIND ${path}`);
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    // 4 MiB of deterministic filler, with working Range support so the
    // streaming proxy can be exercised for real.
    const total = 4 * 1024 * 1024;
    const range = req.headers.range;
    const fill = (start, end) => {
      const buf = Buffer.alloc(end - start + 1);
      for (let i = 0; i < buf.length; i++) buf[i] = (start + i) % 251;
      return buf;
    };

    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m && m[1] ? Number(m[1]) : 0;
      const end = m && m[2] ? Math.min(Number(m[2]), total - 1) : total - 1;
      res.writeHead(206, {
        'Content-Type': 'application/octet-stream',
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Content-Length': end - start + 1,
        'Accept-Ranges': 'bytes',
      });
      res.end(req.method === 'HEAD' ? undefined : fill(start, end));
      console.log(`206 ${req.method} ${path} ${range}`);
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': total,
      'Accept-Ranges': 'bytes',
    });
    res.end(req.method === 'HEAD' ? undefined : fill(0, total - 1));
    console.log(`200 ${req.method} ${path}`);
    return;
  }

  res.writeHead(405).end('method not allowed');
});

server.listen(PORT, () => {
  console.log(`Mock WebDAV on http://127.0.0.1:${PORT}${ROOT}  (demo / secret)`);
});
