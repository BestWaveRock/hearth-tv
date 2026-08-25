#!/usr/bin/env node
/**
 * Schema migration runner.
 *
 * `schema.sql` is written with `CREATE TABLE IF NOT EXISTS`, which is enough for
 * a fresh database but does nothing to a table that already exists. So adding a
 * column to a deployed instance needs a real `ALTER TABLE`, and D1/SQLite has no
 * `ADD COLUMN IF NOT EXISTS`.
 *
 * Rather than swallow "duplicate column" errors, this inspects the live schema
 * with `PRAGMA table_info` and only applies what is genuinely missing. That
 * keeps the run idempotent *and* keeps real errors loud.
 *
 * Usage:  node tools/migrate.mjs [--remote|--local]
 */

import { execFileSync } from 'node:child_process';

const DB = 'hearth-tv';
const REMOTE = process.argv.includes('--remote');
const LOCATION = REMOTE ? '--remote' : '--local';

/** Columns this version of the code requires, per table. */
const REQUIRED_COLUMNS = [
  {
    table: 'sources',
    column: 'access',
    ddl: "ALTER TABLE sources ADD COLUMN access TEXT NOT NULL DEFAULT 'proxy'",
    why: 'proxy vs direct access mode',
  },
];

function d1(args, { allowFailure = false } = {}) {
  try {
    return {
      ok: true,
      out: execFileSync('npx', ['wrangler', 'd1', ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      }),
    };
  } catch (err) {
    const detail = [err.stdout, err.stderr].filter(Boolean).map(String).join('\n');
    if (allowFailure) return { ok: false, out: detail };
    throw new Error(`wrangler d1 ${args.join(' ')} failed:\n${detail}`);
  }
}

/** Wrangler prints a banner before its JSON payload. */
function parseJson(text) {
  const start = text.search(/[[{]/);
  if (start === -1) return null;
  for (let end = text.length; end > start; end--) {
    const slice = text.slice(start, end).trimEnd();
    if (!/[\]}]$/.test(slice)) continue;
    try {
      return JSON.parse(slice);
    } catch {
      /* keep shrinking */
    }
  }
  return null;
}

function query(sql) {
  const res = d1(['execute', DB, LOCATION, '--json', '--command', sql]);
  const parsed = parseJson(res.out);
  if (!Array.isArray(parsed)) return [];
  return parsed[0]?.results ?? [];
}

function main() {
  console.log(`Applying schema to the ${REMOTE ? 'remote' : 'local'} database…`);

  // Step 1: create anything that does not exist yet.
  d1(['execute', DB, LOCATION, '--file=./schema.sql']);
  console.log('  base schema applied');

  // Step 2: add columns missing from tables that already existed.
  let applied = 0;
  for (const { table, column, ddl, why } of REQUIRED_COLUMNS) {
    const info = query(`PRAGMA table_info(${table})`);
    if (!info.length) {
      console.log(`  ${table}: table absent, skipping column check`);
      continue;
    }
    const has = info.some((row) => row.name === column);
    if (has) {
      console.log(`  ${table}.${column}: already present`);
      continue;
    }
    console.log(`  ${table}.${column}: adding (${why})`);
    d1(['execute', DB, LOCATION, '--command', ddl]);
    applied++;
  }

  console.log(
    applied === 0
      ? 'Schema already up to date.'
      : `Schema updated: ${applied} column(s) added.`,
  );
}

try {
  main();
} catch (err) {
  console.error(`\n${err.message}`);
  process.exit(1);
}
