#!/usr/bin/env node
/**
 * Idempotent Cloudflare provisioning for CI.
 *
 * Deploying Hearth needs two things that are specific to an account and so are
 * not in git: a D1 database id, and the credential-vault key. Requiring a human
 * to create both by hand and paste an id into wrangler.toml is exactly the kind
 * of setup step that gets done wrong once and then debugged for an hour, so this
 * does it automatically:
 *
 *   ensure-db   finds the D1 database by name, creates it only if missing, and
 *               writes its id into wrangler.toml for this build. The id is never
 *               committed; it is resolved fresh on every deploy.
 *
 *   ensure-key  sets ENCRYPTION_KEY only when the Worker does not already have
 *               one. It must never rotate: a new key would make every stored
 *               storage credential undecryptable. The value is piped on stdin so
 *               it cannot reach argv or the logs.
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
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Runs wrangler and always returns a result rather than throwing, so callers can
 * tell the difference between "the command worked and found nothing" and "the
 * command failed". Conflating those two is what made an authentication failure
 * look like an empty account in an earlier version of this script.
 */
function wrangler(args, { stdin } = {}) {
  try {
    const stdout = execFileSync('npx', ['wrangler', ...args], {
      encoding: 'utf8',
      stdio: stdin === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
      input: stdin,
      env: process.env,
    });
    return { ok: true, stdout, stderr: '' };
  } catch (err) {
    return {
      ok: false,
      stdout: err.stdout ? String(err.stdout) : '',
      stderr: err.stderr ? String(err.stderr) : String(err.message ?? ''),
    };
  }
}

/** Strips ANSI colour so error text can be matched and printed cleanly. */
function plain(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Wrangler prints a banner before its JSON, so the payload is extracted. */
function parseJson(output) {
  const start = output.search(/[[{]/);
  if (start === -1) return null;
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

function isAuthFailure(text) {
  const t = plain(text);
  return (
    /Authentication error/i.test(t) ||
    /code:\s*10000/.test(t) ||
    /Unable to authenticate/i.test(t) ||
    /not authorized/i.test(t) ||
    /\[code:\s*(7003|9109|10001)\]/.test(t)
  );
}

/**
 * The single most likely reason this script fails: the API token was created
 * from the "Edit Cloudflare Workers" template, which does **not** include D1.
 * Saying so precisely is worth far more than relaying Cloudflare's error.
 */
function explainAuthFailure(detail) {
  console.error('\n──────────────────────────────────────────────────────────────');
  console.error('Cloudflare rejected the API token.');
  console.error('──────────────────────────────────────────────────────────────\n');
  console.error('Almost always this means the token is missing the D1 permission.');
  console.error('The "Edit Cloudflare Workers" template does not include D1.\n');
  console.error('Create a token at https://dash.cloudflare.com/profile/api-tokens');
  console.error('using "Create Custom Token" with these permissions:\n');
  console.error('    Account · Workers Scripts        · Edit');
  console.error('    Account · D1                     · Edit');
  console.error('    Account · Workers KV Storage     · Edit');
  console.error('    Account · Account Settings       · Read\n');
  console.error('Then update the CLOUDFLARE_API_TOKEN repository secret:');
  console.error('  Settings → Secrets and variables → Actions → CLOUDFLARE_API_TOKEN\n');
  console.error('Also confirm CLOUDFLARE_ACCOUNT_ID is the Account ID from the');
  console.error('Cloudflare dashboard sidebar, not a Zone ID.\n');
  if (detail) {
    console.error('Cloudflare reported:');
    console.error(
      plain(detail)
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => `  ${l.trim()}`)
        .join('\n'),
    );
  }
  process.exit(1);
}

/** Returns the database id, or null when the account genuinely has no such database. */
function findDatabaseId() {
  const res = wrangler(['d1', 'list', '--json']);
  if (!res.ok) {
    if (isAuthFailure(res.stderr + res.stdout)) explainAuthFailure(res.stderr || res.stdout);
    throw new Error(`Could not list D1 databases:\n${plain(res.stderr || res.stdout)}`);
  }
  const listed = parseJson(res.stdout);
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

    // `wrangler d1 create` has no --json flag in v4 (only `d1 list` does), so
    // the id is read from the wrangler.toml snippet it prints.
    const res = wrangler(['d1', 'create', DB_NAME]);
    if (!res.ok) {
      const text = res.stderr + res.stdout;
      if (isAuthFailure(text)) explainAuthFailure(res.stderr || res.stdout);
      // A concurrent deploy may have created it between our list and create.
      if (/already exists/i.test(plain(text))) {
        console.log('Another run created it first; re-listing.');
        uuid = findDatabaseId();
      } else {
        throw new Error(`Could not create the D1 database:\n${plain(text)}`);
      }
    } else {
      const fromToml = res.stdout.match(/database_id\s*=\s*"([^"]+)"/);
      uuid = fromToml?.[1] ?? res.stdout.match(UUID_RE)?.[0] ?? null;
      if (!uuid) {
        console.log('Could not read the id from the creation output; re-listing.');
        uuid = findDatabaseId();
      }
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

  // A brand-new Worker has no secret list yet, which is not an error here.
  const res = wrangler(['secret', 'list']);
  const output = res.stdout + res.stderr;

  if (!res.ok && isAuthFailure(output)) explainAuthFailure(res.stderr || res.stdout);

  const listed = parseJson(res.stdout);

  // Prefer structured output, then fall back to a text search. An unparseable
  // result is treated as "key present": doing nothing is harmless, whereas
  // wrongly deciding it is absent would rotate the key and destroy every
  // stored storage credential.
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

  const put = wrangler(['secret', 'put', 'ENCRYPTION_KEY'], { stdin: key });
  if (!put.ok) {
    const text = put.stderr + put.stdout;
    if (isAuthFailure(text)) explainAuthFailure(put.stderr || put.stdout);
    throw new Error(`Could not set ENCRYPTION_KEY:\n${plain(text)}`);
  }
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
