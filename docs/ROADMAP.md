# Roadmap / Extension Points

Features intentionally left out of this MVP, roughly in the order they'd
likely come up, with notes on where to hook them in.

## Near-term

- **Horizontal scaling / multi-instance.** Right now `RoomManager` and
  `MatchmakingQueue` are in-process `Map`s — this only works with a single
  server instance. If you need more than one process (e.g. HF Spaces
  autoscaling, or just more headroom), you'd move room/queue state into Redis
  (or Supabase Realtime/Postgres as a lighter option) and use the
  [Socket.IO Redis adapter](https://socket.io/docs/v4/redis-adapter/) so
  `io.to(roomId).emit(...)` works across instances. The `.env.example`
  intentionally avoids adding Redis until this is actually needed, per the
  "don't add Redis until you need it" constraint.
- **Move-time / behavior analytics.** Log per-move think-time server-side
  (already have `serverTimestamp` on every `MoveRecord`) and flag statistical
  outliers (e.g. consistently <200ms on non-trivial positions) for review,
  the same way `level_replays.suspicious` already works for campaign.
- **Leaderboards.** `users.elo` + the existing index (`idx_users_elo`) already
  support a simple `ORDER BY elo DESC LIMIT N` leaderboard endpoint — add a
  `GET /api/leaderboard` route when needed.
- **Puzzle-style campaign levels.** `CampaignLevel.startFen` already supports
  a non-standard starting position, so tactical-puzzle levels ("find mate in
  2") fit the existing model without schema changes — just add more win
  condition types (e.g. `{ type: 'mate_in_n', n: 2 }`) to `validateCampaign.ts`.
- **Move campaign level content into the database.** Currently
  `CAMPAIGN_LEVELS` is a static TS array (simple, no extra table, but requires
  a redeploy to add levels). If you want to ship new levels without shipping
  new server code, add a `campaign_levels` table mirroring `CampaignLevel` and
  read from it in `getLevel()` instead.

## Medium-term

- **Tournaments / brackets.** Would sit alongside the existing `matches` table
  — add a `tournaments` + `tournament_matches` table, and reuse `GameRoom`
  as-is for each individual game.
- **Friends / direct challenges.** A `friends` table + a
  `room:challenge_friend` socket event that creates a pending room targeted at
  a specific `userId` instead of a shareable code.
- **Per-time-control Elo / ratings.** Currently one global `users.elo`. Real
  chess sites track separate ratings per time control (bullet/blitz/rapid).
  Would mean replacing the single `elo` column with an `elo_by_time_control`
  table and updating `matchService`/`MatchmakingQueue` accordingly.
- **Push notifications for async campaign progress / friend challenges** via
  FCM — the backend already has the right hook point (`persistCampaignResult`,
  `room:create`) to fire an event into a notification service.

## Longer-term / bigger architectural changes

- **Anti-cheat beyond legality checking**, e.g. server-side engine correlation
  analysis (comparing player moves against engine top choices to flag
  suspiciously high accuracy) — a much bigger undertaking, only worth it once
  the game has enough rated players that this becomes a real problem.
- **Spectator chat moderation tooling** (mute/ban from `chat_logs`), building
  on the audit tables that already exist.
- **Server-side campaign AI verification** for a subset of "official" levels,
  as discussed as a known gap in `docs/SECURITY.md`.
