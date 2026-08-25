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

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Finds the database's id by name, or null if it does not exist yet. */
function findDatabaseId() {
  const listed = parseJson(wrangler(['d1', 'list', '--json'], { allowFailure: true }));
  if (!Array.isArray(listed)) return null;
  const match = listed.find((db) => db.name === DB_NAME);
  return match?.uuid ?? match?.database_id ?? null;
}

function ensureDatabase() {
  console.log(`Looking for D1 database "${DB_NAME}"…`);

  let uuid = findDatabaseId();

  if (uuid) {
    console.log(`Found existing database (${uuid}).`);
  } else {
    console.log('Not found — creating it.');

    // `wrangler d1 create` has no --json flag (only `d1 list` does), so the id
    // is read out of the wrangler.toml snippet it prints, with a re-list as a
    // fallback in case that output format ever changes.
    const output = wrangler(['d1', 'create', DB_NAME]);
    const fromToml = output.match(/database_id\s*=\s*"([^"]+)"/);
    uuid = fromToml?.[1] ?? output.match(UUID_RE)?.[0] ?? null;

    if (!uuid) {
      console.log('Could not read the id from the creation output; re-listing.');
      uuid = findDatabaseId();
    }
    if (!uuid) throw new Error('Created the database but could not determine its id.');
    console.log(`Created database (${uuid}).`);
  }

  if (!UUID_RE.test(uuid)) {
    throw new Error(`Resolved database id does not look like a UUID: ${uuid}`);
  }

  const toml = readFileSync(WRANGLER_TOML, 'utf8');
  const patched = toml.replace(/database_id\s*=\s*"[^"]*"/, `database_id = "${uuid}"`);

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
  const output = wrangler(['secret', 'list'], { allowFailure: true });
  const listed = parseJson(output);

  // Prefer structured output, but fall back to a plain text search: guessing
  // wrong here would silently rotate the key, and that destroys stored
  // credentials. When in doubt, treat the key as present and do nothing.
  const present = Array.isArray(listed)
    ? listed.some((s) => s?.name === 'ENCRYPTION_KEY')
    : output.includes('ENCRYPTION_KEY');

  if (present) {
    console.log('ENCRYPTION_KEY is already set — leaving it untouched.');
    console.log('(Rotating it would make stored storage credentials undecryptable.)');
    return;
  }

  console.log('No ENCRYPTION_KEY found. Generating a 32-byte key.');
  const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');

  // Piped on stdin so the value never appears in argv or in the logs.
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
