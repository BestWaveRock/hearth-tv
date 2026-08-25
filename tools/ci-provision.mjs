#!/usr/bin/env node
/**
 * Idempotent Cloudflare provisioning for CI.
 *
 * Deploying Hearth needs two things that are specific to an account and are
 * therefore not in git: a D1 database id, and the credential-vault key.
 * Requiring a human to create both by hand and paste an id into wrangler.toml
 * is exactly the kind of setup step that gets done wrong once and then debugged
 * for an hour, so this does it automatically and safely:
 *
 *   - `ensure-db`  finds the D1 database by name, creates it only if missing,
 *                  and writes its id into wrangler.toml for this build. The id
 *                  is never committed; it is resolved fresh on every deploy.
 *
 *   - `ensure-key` sets ENCRYPTION_KEY only when the Worker does not already
 *                  have one. This must never regenerate: rotating the key would
 *                  make every stored storage credential undecryptable. The key
 *                  is piped to wrangler on stdin so it cannot reach the logs.
 *
 * Usage:  node tools/ci-provision.mjs ensure-db|ensure-key
 *
 * Requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const DB_NAME = 'hearth-tv';
const WRANGLER_TOML = 'wrangler.toml';
const PLACEHOLDER = 'PLACEHOLDER_RUN_npm_run_db_create';

function wrangler(args, { allowFailure = false, stdin } = {}) {
  try {
    return execFileSync('npx', ['wrangler', ...args], {
      encoding: 'utf8',
      stdio: stdin === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
      input: stdin,
      env: process.env,
    });
  } catch (err) {
    if (allowFailure) return '';
    const stderr = err.stderr ? String(err.stderr) : '';
    const stdout = err.stdout ? String(err.stdout) : '';
    throw new Error(`wrangler ${args.join(' ')} failed:\n${stderr || stdout || err.message}`);
  }
}

/**
 * Wrangler prints a banner before its JSON, so the payload is extracted rather
 * than assuming the whole of stdout parses.
 */
function parseJson(output) {
  const start = output.search(/[[{]/);
  if (start === -1) return null;
  // Walk back from the end to the matching close, tolerating trailing log lines.
  for (let end = output.length; end > start; end--) {
    const slice = output.slice(start, end);
    const last = slice.trimEnd().slice(-1);
    if (last !== ']' && last !== '}') continue;
    try {
      return JSON.parse(slice.trim());
    } catch {
      /* keep shrinking */
    }
  }
  return null;
}

function ensureDatabase() {
  console.log(`Looking for D1 database "${DB_NAME}"…`);

  const listed = parseJson(wrangler(['d1', 'list', '--json'], { allowFailure: true }));
  let uuid = Array.isArray(listed)
    ? listed.find((db) => db.name === DB_NAME)?.uuid ?? null
    : null;

  if (uuid) {
    console.log(`Found existing database (${uuid}).`);
  } else {
    console.log('Not found — creating it.');
    const created = parseJson(wrangler(['d1', 'create', DB_NAME, '--json']));
    uuid = created?.uuid ?? created?.database_id ?? null;

    if (!uuid) {
      // Some wrangler versions do not honour --json on create; re-list.
      const relisted = parseJson(wrangler(['d1', 'list', '--json'], { allowFailure: true }));
      uuid = Array.isArray(relisted)
        ? relisted.find((db) => db.name === DB_NAME)?.uuid ?? null
        : null;
    }
    if (!uuid) throw new Error('Created the database but could not determine its id.');
    console.log(`Created database (${uuid}).`);
  }

  const toml = readFileSync(WRANGLER_TOML, 'utf8');
  const patched = toml.replace(
    /database_id\s*=\s*"[^"]*"/,
    `database_id = "${uuid}"`,
  );

  if (patched === toml && !toml.includes(uuid)) {
    throw new Error(`Could not find a database_id line to update in ${WRANGLER_TOML}.`);
  }
  writeFileSync(WRANGLER_TOML, patched);

  if (patched.includes(PLACEHOLDER)) {
    throw new Error('wrangler.toml still contains the placeholder after patching.');
  }
  console.log(`Wrote database_id into ${WRANGLER_TOML}.`);
}

function ensureKey() {
  console.log('Checking whether the Worker already has ENCRYPTION_KEY…');

  // A brand-new Worker has no secret list at all; that is not an error here.
  const listed = parseJson(wrangler(['secret', 'list'], { allowFailure: true }));
  const names = Array.isArray(listed) ? listed.map((s) => s.name) : [];

  if (names.includes('ENCRYPTION_KEY')) {
    console.log('ENCRYPTION_KEY is already set — leaving it untouched.');
    console.log('(Rotating it would make stored storage credentials undecryptable.)');
    return;
  }

  console.log('No ENCRYPTION_KEY found. Generating a 32-byte key.');
  const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');

  // Piped on stdin so the value never appears in an argv or in the logs.
  wrangler(['secret', 'put', 'ENCRYPTION_KEY'], { stdin: key });
  console.log('ENCRYPTION_KEY set. It exists only in Cloudflare’s secret store.');
}

const command = process.argv[2];

if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
  console.error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must both be set.');
  process.exit(1);
}

try {
  if (command === 'ensure-db') ensureDatabase();
  else if (command === 'ensure-key') ensureKey();
  else {
    console.error('Usage: node tools/ci-provision.mjs ensure-db|ensure-key');
    process.exit(1);
  }
} catch (err) {
  console.error(`\n${err.message}`);
  process.exit(1);
}
