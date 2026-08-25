/// <reference types="@cloudflare/workers-types" />

import type { User } from '../shared/types';

export interface Env {
  /** Workers Static Assets binding — serves the built SPA. */
  ASSETS: Fetcher;
  DB: D1Database;
  REMOTE_ROOM: DurableObjectNamespace;

  /** Required secret: base64 of 32 random bytes. `npm run secret:key`. */
  ENCRYPTION_KEY: string;

  APP_NAME?: string;
  /** Override PBKDF2 cost; lower it if the Workers free plan trips its CPU limit. */
  PBKDF2_ITERATIONS?: string;
  /** Set to "false" to lock the instance down after you have registered. */
  ALLOW_SIGNUP?: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    user: User;
    sessionId: string;
    /** Lazily-imported AES-GCM key for the credential vault. */
    vault: CryptoKey;
  };
};
