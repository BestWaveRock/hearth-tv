/// <reference types="@cloudflare/workers-types" />

import { HTTPException } from 'hono/http-exception';
import type { SourceKind, SourceSummary, MediaRole } from '../../shared/types';
import { unseal } from '../crypto';
import type { Env } from '../env';
import { openlistAdapter } from './openlist';
import { subsonicAdapter } from './subsonic';
import { webdavAdapter } from './webdav';
import type { Adapter, Credentials, SourceContext } from './util';

export * from './util';

export interface SourceRow {
  id: string;
  user_id: string;
  kind: SourceKind;
  name: string;
  base_url: string;
  root_path: string;
  media: MediaRole;
  secret_blob: string;
  sort_order: number;
  last_ok_at: number | null;
  last_error: string | null;
  created_at: number;
}

const ADAPTERS: Record<SourceKind, Adapter> = {
  webdav: webdavAdapter,
  navidrome: subsonicAdapter,
  openlist: openlistAdapter,
};

export function adapterFor(kind: SourceKind): Adapter {
  const a = ADAPTERS[kind];
  if (!a) throw new HTTPException(400, { message: `Unsupported source type: ${kind}` });
  return a;
}

export const SOURCE_KINDS: SourceKind[] = ['webdav', 'navidrome', 'openlist'];

export function isSourceKind(v: unknown): v is SourceKind {
  return typeof v === 'string' && (SOURCE_KINDS as string[]).includes(v);
}

/** `alice` -> `al•••`. Enough to recognise, useless to an attacker. */
function maskUsername(u?: string): string | null {
  if (!u) return null;
  if (u.length <= 2) return u[0] + '•••';
  return u.slice(0, 2) + '•'.repeat(Math.min(6, Math.max(3, u.length - 2)));
}

export async function rowToSummary(vault: CryptoKey, row: SourceRow): Promise<SourceSummary> {
  let creds: Credentials = {};
  try {
    creds = await unseal<Credentials>(vault, row.secret_blob);
  } catch {
    // A rotated ENCRYPTION_KEY makes old blobs unreadable. Surface it instead
    // of throwing, so the user can re-enter the password from the UI.
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      baseUrl: row.base_url,
      rootPath: row.root_path,
      media: row.media,
      hasCredentials: false,
      usernameMasked: null,
      lastOkAt: row.last_ok_at,
      lastError: 'Stored credentials could not be decrypted — please re-enter them.',
      createdAt: row.created_at,
      sortOrder: row.sort_order,
    };
  }

  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    baseUrl: row.base_url,
    rootPath: row.root_path,
    media: row.media,
    hasCredentials: Boolean(creds.password || creds.token),
    usernameMasked: maskUsername(creds.username),
    lastOkAt: row.last_ok_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    sortOrder: row.sort_order,
  };
}

export async function fetchSourceRows(env: Env, userId: string): Promise<SourceRow[]> {
  const res = await env.DB.prepare(
    'SELECT * FROM sources WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC',
  )
    .bind(userId)
    .all<SourceRow>();
  return res.results ?? [];
}

/** Loads one source and decrypts its credentials into a ready-to-use context. */
export async function loadContext(
  env: Env,
  vault: CryptoKey,
  userId: string,
  sourceId: string,
): Promise<SourceContext> {
  const row = await env.DB.prepare('SELECT * FROM sources WHERE id = ? AND user_id = ?')
    .bind(sourceId, userId)
    .first<SourceRow>();

  if (!row) throw new HTTPException(404, { message: 'That data source no longer exists.' });

  let creds: Credentials;
  try {
    creds = await unseal<Credentials>(vault, row.secret_blob);
  } catch {
    throw new HTTPException(409, {
      message: `Credentials for “${row.name}” could not be decrypted. Open Settings and re-enter the password.`,
    });
  }

  return contextFromRow(row, creds);
}

export function contextFromRow(row: SourceRow, creds: Credentials): SourceContext {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    baseUrl: row.base_url,
    rootPath: row.root_path,
    media: row.media,
    creds,
  };
}

/** Records the outcome of a source access so the UI can show health at a glance. */
export async function noteSourceHealth(
  env: Env,
  sourceId: string,
  error: string | null,
): Promise<void> {
  try {
    if (error) {
      await env.DB.prepare('UPDATE sources SET last_error = ? WHERE id = ?')
        .bind(error.slice(0, 300), sourceId)
        .run();
    } else {
      await env.DB.prepare('UPDATE sources SET last_ok_at = ?, last_error = NULL WHERE id = ?')
        .bind(Date.now(), sourceId)
        .run();
    }
  } catch {
    // Health tracking is best-effort; never fail a playback request over it.
  }
}
