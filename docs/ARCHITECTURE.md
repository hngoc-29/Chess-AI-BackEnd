# Architecture

## Module diagram

```
                        ┌─────────────────────────┐
                        │   Flutter app (game/)   │
                        │  (unmodified by this     │
                        │   backend — client only) │
                        └────────────┬─────────────┘
                                     │  HTTPS (REST) + WSS (Socket.IO)
                                     │  auth: Supabase access token
                                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│                          Node.js backend (this repo)                 │
│                                                                        │
│  ┌───────────────┐   ┌────────────────────┐   ┌────────────────────┐ │
│  │ Express (REST)│   │   Socket.IO server  │   │  Global tick loop  │ │
│  │ /api/auth     │   │  auth middleware ─┐ │   │  (1s interval):     │ │
│  │ /api/matches  │   │                   ▼ │   │  - matchmaking.tick│ │
│  │ /api/campaign │   │  handlers/         │   │  - room timeouts    │ │
│  │ /health       │   │   matchmaking.ts   │   │  - pending room TTL │ │
│  └──────┬────────┘   │   room.ts          │   └─────────┬──────────┘ │
│         │             │   game.ts          │             │            │
│         │             │   spectator.ts     │             │            │
│         │             │   chat.ts          │             │            │
│         │             └─────────┬──────────┘             │            │
│         │                       │                        │            │
│         ▼                       ▼                        ▼            │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                    engine/ (in-memory, RAM only)                │  │
│  │  RoomManager ── owns Map<roomId, GameRoom>                      │  │
│  │  GameRoom ─────  chess.js instance + GameClock + spectators     │  │
│  │  MatchmakingQueue ── Map<userId, QueueEntry>, Elo-based pairing │  │
│  └──────────────────────────────┬───────────────────────────────┘  │
│                                  │  on finish / campaign submit       │
│                                  ▼                                    │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │        services/ (matchService, campaignService)                │  │
│  │        auth/ (verifyToken, ensureProfile)                       │  │
│  └──────────────────────────────┬───────────────────────────────┘  │
└─────────────────────────────────┼──────────────────────────────────┘
                                   │  service_role key (server-only)
                                   ▼
                        ┌──────────────────────┐
                        │  Supabase (Postgres)  │
                        │  users, matches,      │
                        │  user_levels,         │
                        │  level_replays,       │
                        │  room_logs, chat_logs,│
                        │  spectator_logs        │
                        └──────────────────────┘
```

## Data flow

1. **Auth.** The Flutter app signs in via Supabase Auth directly (this backend
   never sees passwords/OAuth). It gets a Supabase access token and sends it
   either as a `Bearer` header (REST) or in the Socket.IO `auth` handshake
   payload.
2. **Verification.** The backend calls `supabaseAuthClient.auth.getUser(token)`
   to resolve the token to a real `userId` — this is the only identity the
   rest of the system trusts. `ensureProfile` then looks up (or creates) the
   matching `users` row.
3. **Live gameplay** happens entirely against in-memory `GameRoom` objects; no
   database read/write happens per-move (keeps latency low). Every move is
   still validated against real chess rules via `chess.js` inside `GameRoom`.
4. **Persistence** happens once, at the moment a room transitions to
   `finished` (checkmate/resign/timeout/draw/abandon) — `matchService`
   writes one row to `matches` and, if rated, updates both players' `elo` in
   a single pass. Campaign completions persist via `campaignService`
   immediately after `validateCampaignSubmission` re-simulates the submitted
   moves.
5. **Reads** (match history, replay, campaign progress) go straight to
   Supabase via REST endpoints — there's no reason to cache these in RAM,
   they're already fast indexed Postgres queries and this keeps the backend
   itself stateless with respect to historical data (only *live* games are
   RAM-resident).

## Socket.IO flow

1. Client connects with `{ auth: { token } }`.
2. `socketAuthMiddleware` (an `io.use()` middleware, runs before any handler)
   verifies the token and attaches `socket.data = { userId, profile }`. A
   socket that fails this is disconnected with a `connect_error` and never
   reaches step 3.
3. On `connection`, all five handler modules register their listeners on that
   socket (`registerMatchmakingHandlers`, `registerRoomHandlers`,
   `registerGameHandlers`, `registerSpectatorHandlers`, `registerChatHandlers`).
   `registerGameHandlers` also immediately checks "does this user already have
   an active room?" and if so re-joins them to it and pushes fresh state —
   this is the reconnect path, no special "reconnect" event needed from the
   client.
4. Gameplay events (`game:move`, etc.) look up the `GameRoom` by `roomId` from
   `RoomManager`, delegate the actual rule-checking to the room, then
   broadcast the result with `io.to(roomId).emit(...)` — this reaches both
   players *and* all spectators, since spectators join the same Socket.IO
   room (`socket.join(room.id)`) as players.
5. Disconnects start a grace-period timer; a reconnect within the window
   cancels it (step 3 handles the cancel), otherwise the player forfeits.

## Why RAM state (and not, say, Postgres-per-move)

Chess games are short-lived (minutes) and highly latency-sensitive per move.
Keeping the authoritative live board in a plain JS object (`GameRoom`) avoids
a database round-trip on every single move, which would otherwise be the
dominant cost of `game:move` handling. The tradeoff — state is lost if the
process restarts mid-game — is accepted for this MVP and explicitly called
out in `README.md`'s HF Spaces deployment notes and `docs/ROADMAP.md`'s
horizontal-scaling section, rather than silently ignored.

## Supabase connection strategy

Two separate Supabase JS clients on purpose (`src/db/supabase.ts`):

- **`supabaseAdmin`** (service-role key) — used for all actual reads/writes of
  game data (`matches`, `user_levels`, `level_replays`, `chat_logs`,
  `spectator_logs`, `users`). This key bypasses Row Level Security entirely,
  which is required because the backend needs to write results *on behalf
  of* users who aren't the ones making the authenticated Postgres call. This
  key lives only in server env vars / HF Spaces secrets.
- **`supabaseAuthClient`** (anon key) — used for exactly one thing:
  `auth.getUser(token)` to verify a client-presented access token. It cannot
  read or write application tables on its own (RLS still applies to it), so
  even if this client object were somehow misused elsewhere in the codebase,
  it can't leak data the way the admin client could.

RLS policies in `sql/schema.sql` are defense-in-depth for the scenario where
you later let the Flutter app talk to Supabase directly with the anon key
(e.g. a public leaderboard) — as long as this backend is the only writer
(which it is, since only it holds the service-role key), the policies mainly
just need to allow the right *reads*.
