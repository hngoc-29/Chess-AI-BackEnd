-- ============================================================================
-- Chess Online — Supabase / PostgreSQL schema
-- Run this in the Supabase SQL editor (or `psql` against your project).
-- Idempotent-ish: uses IF NOT EXISTS / OR REPLACE where practical.
-- ============================================================================

create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ----------------------------------------------------------------------------
-- updated_at trigger helper (reused by every table with an updated_at column)
-- ----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================================
-- users — app-level profile, 1:1 with auth.users. Created lazily by the
-- backend (ensureProfile) the first time a Supabase-authenticated user is
-- seen. Never written to directly by the client.
-- ============================================================================
create table if not exists users (
  id              uuid primary key references auth.users(id) on delete cascade,
  display_name    text not null,
  avatar_url      text,
  elo             integer not null default 1200 check (elo between 0 and 4000),
  games_played    integer not null default 0,
  games_won       integer not null default 0,
  games_drawn     integer not null default 0,
  games_lost      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_users_elo on users (elo desc);

drop trigger if exists trg_users_updated_at on users;
create trigger trg_users_updated_at
  before update on users
  for each row execute function set_updated_at();

-- ============================================================================
-- matches — one row per finished ranked or custom-room game. The server is
-- the only writer (service_role key); this table is the permanent record
-- used for history, replay, and Elo audit.
-- ============================================================================
create table if not exists matches (
  id                  uuid primary key default gen_random_uuid(),
  white_id            uuid not null references users(id) on delete set null,
  black_id            uuid not null references users(id) on delete set null,
  winner_id           uuid references users(id) on delete set null, -- null = draw
  result_type         text not null check (result_type in (
                        'checkmate', 'resign', 'timeout', 'stalemate',
                        'draw_agreement', 'threefold_repetition',
                        'fifty_move_rule', 'insufficient_material', 'abandoned'
                      )),
  rated               boolean not null default false,
  time_control        text not null,            -- e.g. "600+5" (seconds+increment)
  white_time_left_ms  integer not null default 0,
  black_time_left_ms  integer not null default 0,
  moves_count         integer not null default 0,
  pgn                 text not null,
  final_fen           text not null,
  started_at          timestamptz not null,
  ended_at            timestamptz not null,
  duration_ms         integer not null,
  white_elo_before    integer not null,
  white_elo_after     integer not null,
  black_elo_before    integer not null,
  black_elo_after     integer not null,
  created_at          timestamptz not null default now()
);

create index if not exists idx_matches_white on matches (white_id, ended_at desc);
create index if not exists idx_matches_black on matches (black_id, ended_at desc);
create index if not exists idx_matches_ended_at on matches (ended_at desc);
create index if not exists idx_matches_rated on matches (rated) where rated = true;

-- ============================================================================
-- user_levels — campaign / Vượt ải progress. One row per (user, level).
-- Only ever upgraded (higher stars, never downgraded) by campaignService.
-- ============================================================================
create table if not exists user_levels (
  user_id           uuid not null references users(id) on delete cascade,
  level_id          text not null,
  completed         boolean not null default false,
  stars             smallint not null default 0 check (stars between 0 and 3),
  best_duration_ms  integer,
  best_replay_id    uuid, -- fk added below, after level_replays exists
  attempts          integer not null default 1,
  last_attempt_at   timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  primary key (user_id, level_id)
);

create index if not exists idx_user_levels_user on user_levels (user_id);

-- ============================================================================
-- level_replays — every campaign attempt (not just successful ones), for
-- replay viewing and anti-cheat auditing (the `suspicious` flag).
-- ============================================================================
create table if not exists level_replays (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  level_id      text not null,
  pgn           text not null,
  final_fen     text not null,
  moves_count   integer not null,
  duration_ms   integer not null,
  completed     boolean not null,
  suspicious    boolean not null default false, -- flagged by validateCampaignSubmission's timing heuristic
  created_at    timestamptz not null default now()
);

create index if not exists idx_level_replays_user_level on level_replays (user_id, level_id, created_at desc);
create index if not exists idx_level_replays_suspicious on level_replays (suspicious) where suspicious = true;

alter table user_levels
  add constraint fk_user_levels_best_replay
  foreign key (best_replay_id) references level_replays(id) on delete set null;

-- ============================================================================
-- room_logs — lightweight audit trail of live rooms (both ranked and custom).
-- The live room itself lives in server RAM (RoomManager); this table is a
-- historical record written on room creation and on finish, mainly for
-- moderation/analytics, not for gameplay logic.
-- ============================================================================
create table if not exists room_logs (
  id            uuid primary key default gen_random_uuid(),
  room_id       text not null unique, -- in-memory GameRoom.id (nanoid), not a DB fk
  mode          text not null check (mode in ('ranked', 'custom', 'campaign')),
  white_id      uuid references users(id) on delete set null,
  black_id      uuid references users(id) on delete set null,
  match_id      uuid references matches(id) on delete set null,
  created_at    timestamptz not null default now(),
  ended_at      timestamptz
);

create index if not exists idx_room_logs_created_at on room_logs (created_at desc);

-- ============================================================================
-- chat_logs — in-room chat history (moderation / abuse review).
-- ============================================================================
create table if not exists chat_logs (
  id          uuid primary key default gen_random_uuid(),
  room_id     text not null,
  user_id     uuid not null references users(id) on delete cascade,
  message     text not null check (char_length(message) <= 300),
  created_at  timestamptz not null default now()
);

create index if not exists idx_chat_logs_room on chat_logs (room_id, created_at);

-- ============================================================================
-- spectator_logs — who watched which room, for abuse/rate-limit review and
-- basic "most watched games" analytics later.
-- ============================================================================
create table if not exists spectator_logs (
  id          uuid primary key default gen_random_uuid(),
  room_id     text not null,
  user_id     uuid not null references users(id) on delete cascade,
  joined_at   timestamptz not null default now(),
  left_at     timestamptz
);

create index if not exists idx_spectator_logs_room on spectator_logs (room_id);
create index if not exists idx_spectator_logs_user on spectator_logs (user_id);

-- ============================================================================
-- Row Level Security
--
-- The backend talks to Supabase with the service_role key for all writes and
-- most reads (it bypasses RLS by design — see src/db/supabase.ts). RLS below
-- exists as defense-in-depth in case you ever expose direct client-to-Supabase
-- reads (e.g. a public leaderboard query using the anon key from Flutter).
-- If you never do that, RLS is still good practice to enable.
-- ============================================================================
alter table users enable row level security;
alter table matches enable row level security;
alter table user_levels enable row level security;
alter table level_replays enable row level security;
alter table chat_logs enable row level security;
alter table spectator_logs enable row level security;
alter table room_logs enable row level security;

-- Public read of basic profile fields (leaderboards, opponent cards) is fine;
-- writes are blocked entirely because only the service_role (server) writes.
drop policy if exists users_select_all on users;
create policy users_select_all on users for select using (true);

drop policy if exists matches_select_own on matches;
create policy matches_select_own on matches for select
  using (auth.uid() = white_id or auth.uid() = black_id);

drop policy if exists user_levels_select_own on user_levels;
create policy user_levels_select_own on user_levels for select
  using (auth.uid() = user_id);

drop policy if exists level_replays_select_own on level_replays;
create policy level_replays_select_own on level_replays for select
  using (auth.uid() = user_id);

drop policy if exists chat_logs_no_client_access on chat_logs;
create policy chat_logs_no_client_access on chat_logs for select using (false);

drop policy if exists spectator_logs_no_client_access on spectator_logs;
create policy spectator_logs_no_client_access on spectator_logs for select using (false);

drop policy if exists room_logs_no_client_access on room_logs;
create policy room_logs_no_client_access on room_logs for select using (false);

-- No insert/update/delete policies are defined for any table above, which
-- means the anon/authenticated roles cannot write to any of them — only the
-- service_role key (used exclusively by the backend) can, because service_role
-- bypasses RLS entirely.
