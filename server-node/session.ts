/**
 * Session-token hashing for the Node server's WebSocket upgrade check.
 *
 * The upgrade handler runs outside Hono, so it cannot use `server/auth.ts`
 * (which needs a request context). It only needs to turn a bearer token into the
 * hash stored in the sessions table, and that must match `server/crypto.ts`
 * exactly — same algorithm, same base64 encoding — or every TV would be rejected.
 */

import { createHash } from 'node:crypto';

export async function sha256(input: string): Promise<string> {
  return createHash('sha256').update(input, 'utf8').digest('base64');
}
