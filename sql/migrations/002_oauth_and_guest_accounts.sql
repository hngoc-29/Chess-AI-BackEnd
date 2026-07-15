-- Adds Google/Facebook/guest login support and a client-owned settings blob.
--
-- SQLite has no ALTER COLUMN, so relaxing email/password_hash to nullable
-- (guest accounts have neither; OAuth accounts have no password) requires
-- the standard rebuild-and-copy procedure rather than a simple ALTER.
--
-- Apply against an EXISTING database with:
--   turso db shell <name> < sql/migrations/002_oauth_and_guest_accounts.sql
-- A fresh database created from sql/turso-schema.sql already has this shape.

PRAGMA foreign_keys=OFF;

CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  password_hash TEXT,
  -- 'email' covers every row that existed before this migration.
  auth_provider TEXT NOT NULL DEFAULT 'email' CHECK (auth_provider IN ('email', 'google', 'facebook', 'guest')),
  -- External subject id (Google 'sub' claim, Facebook 'id'). NULL for
  -- email/guest accounts. Paired with auth_provider in the unique index
  -- below so the same Google account can never back two rows here.
  provider_id TEXT,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  -- Opaque JSON the backend stores and returns as-is (sound on/off, board
  -- style, etc.) - the client owns the shape, not the schema. Keeps
  -- preference syncing from requiring a migration every time the app adds
  -- a new setting.
  settings TEXT NOT NULL DEFAULT '{}',
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'moderator', 'admin')),
  is_banned INTEGER NOT NULL DEFAULT 0 CHECK (is_banned IN (0, 1)),
  banned_until TEXT,
  ban_reason TEXT,
  elo INTEGER NOT NULL DEFAULT 1200 CHECK (elo BETWEEN 0 AND 4000),
  is_bot INTEGER NOT NULL DEFAULT 0 CHECK (is_bot IN (0, 1)),
  games_played INTEGER NOT NULL DEFAULT 0,
  games_won INTEGER NOT NULL DEFAULT 0,
  games_drawn INTEGER NOT NULL DEFAULT 0,
  games_lost INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO users_new (
  id, email, password_hash, auth_provider, display_name, avatar_url,
  role, is_banned, banned_until, ban_reason, elo, is_bot,
  games_played, games_won, games_drawn, games_lost, created_at, updated_at
)
SELECT
  id, email, password_hash, 'email', display_name, avatar_url,
  role, is_banned, banned_until, ban_reason, elo, is_bot,
  games_played, games_won, games_drawn, games_lost, created_at, updated_at
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE INDEX IF NOT EXISTS idx_users_elo ON users (elo DESC);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_banned ON users (is_banned) WHERE is_banned = 1;
CREATE INDEX IF NOT EXISTS idx_users_bot_elo ON users (is_bot, elo) WHERE is_bot = 1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider ON users (auth_provider, provider_id) WHERE provider_id IS NOT NULL;

PRAGMA foreign_keys=ON;
