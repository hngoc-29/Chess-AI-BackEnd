-- Adds the is_bot flag used by AI-fallback matchmaking (see src/bot/).
--
-- Bot opponents are real rows in `users` — not a separate table — so they
-- flow through existing match persistence / Elo-update code in
-- matchService.ts completely unchanged. This column is only used to (a)
-- pick bot accounts out of the pool and (b) let the admin dashboard filter
-- them out of user-facing lists.
--
-- Apply against an EXISTING database with:
--   turso db shell <name> < sql/migrations/001_add_is_bot_to_users.sql
-- A fresh database created from sql/turso-schema.sql already has this
-- column and does not need this file.

ALTER TABLE users ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0 CHECK (is_bot IN (0, 1));

-- Speeds up "closest elo among bot accounts" lookups in botAccountService.ts.
CREATE INDEX IF NOT EXISTS idx_users_bot_elo ON users(is_bot, elo) WHERE is_bot = 1;
