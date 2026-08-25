-- Hearth TV OS — D1 (SQLite) schema.
-- D1 *is* SQLite, so this is the lightest possible durable store: no ORM,
-- no connection pool, no external service. Timestamps are epoch milliseconds.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  pass_hash     TEXT NOT NULL,          -- PBKDF2-SHA256, base64
  pass_salt     TEXT NOT NULL,          -- 16 random bytes, base64
  pass_iter     INTEGER NOT NULL,       -- iteration count, stored for future upgrades
  avatar_hue    INTEGER NOT NULL DEFAULT 28,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,         -- SHA-256 of the bearer token, never the token
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exp  ON sessions(expires_at);

-- A data source: webdav | navidrome | openlist
CREATE TABLE IF NOT EXISTS sources (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  name        TEXT NOT NULL,
  base_url    TEXT NOT NULL,
  root_path   TEXT NOT NULL DEFAULT '/',
  media       TEXT NOT NULL DEFAULT 'video',  -- video | music | both
  -- proxy  = the Worker fetches (works anywhere, needs a public address)
  -- direct = the browser fetches (works on a LAN, needs CORS on the server)
  access      TEXT NOT NULL DEFAULT 'proxy',
  -- AES-256-GCM ciphertext of {"username":"…","password":"…","token":"…"}.
  -- The plaintext never leaves the Worker and is never returned to a client.
  secret_blob TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  last_ok_at  INTEGER,
  last_error  TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sources_user ON sources(user_id, sort_order);

-- Resume playback. One row per (user, source, path).
CREATE TABLE IF NOT EXISTS progress (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id   TEXT NOT NULL,
  path        TEXT NOT NULL,
  title       TEXT NOT NULL,
  kind        TEXT NOT NULL,            -- video | track
  position    REAL NOT NULL DEFAULT 0,
  duration    REAL NOT NULL DEFAULT 0,
  finished    INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, source_id, path)
);
CREATE INDEX IF NOT EXISTS idx_progress_recent ON progress(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS favorites (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id   TEXT NOT NULL,
  path        TEXT NOT NULL,
  title       TEXT NOT NULL,
  kind        TEXT NOT NULL,            -- video | track | album | folder
  art         TEXT,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, source_id, path)
);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id, created_at DESC);

-- Calibrated remote-control button maps, synced so one calibration works on
-- every computer the account is used from.
CREATE TABLE IF NOT EXISTS remote_profiles (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  driver      TEXT NOT NULL,            -- keyboard | webhid | gamepad | bluetooth | phone
  mapping     TEXT NOT NULL,            -- JSON: { "<signal>": "<action>" }
  device_hint TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_remote_user ON remote_profiles(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  json        TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- Migrations for databases created before a column existed.
--
-- D1 has no "ADD COLUMN IF NOT EXISTS", and re-running the CREATE TABLE above
-- does nothing once the table exists. These statements are applied by
-- tools/migrate.mjs, which tolerates the "duplicate column" error so that
-- running them repeatedly is safe.
--
-- @migration ALTER TABLE sources ADD COLUMN access TEXT NOT NULL DEFAULT 'proxy';
