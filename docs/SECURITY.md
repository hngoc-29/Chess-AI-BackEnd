# Security & Anti-Cheat Checklist

## What this backend already protects against

- **Illegal moves.** Every move is replayed through `chess.js` server-side
  (`GameRoom.applyMove`). The client's claimed FEN/PGN is never trusted; the
  server's own `Chess` instance is the only source of truth for board state.
- **Playing out of turn.** `GameRoom` checks `chess.turn()` against the caller's
  assigned color before accepting a move — a socket authenticated as the black
  player physically cannot submit a move while it's white's turn.
- **Client-decided results.** Checkmate/stalemate/draw detection all run
  server-side (`checkAutomaticEndConditions`). A client cannot emit "I won" —
  only intents (`game:move`, `game:resign`, `game:draw_offer/respond`) exist;
  the *result* is always computed by the server.
- **Client-decided clocks / fake timeouts.** `GameClock` computes remaining
  time from a server-side wall-clock timestamp, not a client-reported number.
  A background tick loop (`socket/index.ts`) independently checks every active
  room for a flagged clock every second, so a player can't avoid losing on
  time by simply not sending a "I flagged" event.
- **Client-decided Elo.** Elo is stored in `users.elo`, updated only by
  `matchService.persistFinishedMatch` using the service-role key after a match
  is server-confirmed finished. The client never sends an Elo value that gets
  written anywhere.
- **Replayed / duplicated moves.** `expectedMoveIndex` lets the client assert
  what move number it thinks it's submitting; a mismatch is rejected
  (`STALE_MOVE_INDEX`) rather than silently applied, which also catches
  double-sent events from flaky connections.
- **Payload validation.** Every Socket.IO and REST payload is parsed through a
  `zod` schema (`src/utils/validation.ts`) before touching game logic —
  malformed squares, oversized chat text, out-of-range settings, etc. are
  rejected at the door.
- **Abuse via event flooding.** `express-rate-limit` covers REST; a
  per-user sliding-window `SocketEventLimiter` covers `game:move`
  (`SOCKET_MOVE_RATE_LIMIT_PER_SEC`, default 10/s) and `chat:message`
  (3 / 2s) at the Socket.IO layer, which `express-rate-limit` never sees.
- **Secrets never reach the client.** `SUPABASE_SERVICE_ROLE_KEY` and all
  other secrets live only in server env vars (`.env` / HF Spaces repository
  secrets) — nothing in this repo ever sends them in a response. The Flutter
  app only ever needs `SUPABASE_URL` + `SUPABASE_ANON_KEY`, both of which are
  meant to be public (Supabase's anon key is safe to ship; RLS is what
  actually protects data, see `sql/schema.sql`).
- **Forged user identity.** Every piece of game logic keys off `socket.data.userId`,
  which is only ever set once, in `socketAuthMiddleware`, from a Supabase
  token the server itself verified — the client never gets to say "I am user X".
- **Abandoning instead of losing.** A disconnect starts a grace-period timer
  (`RECONNECT_GRACE_MS`); if the player hasn't reconnected when it fires and
  the game is still active, they forfeit (`abandoned` result).

## What this cannot fully protect against on an APK, and why

Being upfront, as requested: some things are simply not solvable by "hiding
better" on a client you don't control (rooted devices, APK decompilation,
traffic interception with a user-installed root CA, memory editors, etc. can
all eventually see or alter *outbound requests*). This backend's approach is
to make the server-authoritative architecture the actual defense, not
obfuscation:

- **Extracted API/Socket.IO endpoint and event names.** Decompiling the APK
  will reveal the backend's base URL and the event contract in
  `docs/SOCKET_EVENTS.md`. This is treated as *public by design* — nothing
  sensitive is derived from the endpoint being secret. The real protection is
  that every event still requires a valid Supabase access token
  (`socketAuthMiddleware`) and still goes through full server-side validation
  regardless of who or what sends it.
- **A modified client sending "impossible" but individually legal moves
  quickly.** The server can reject illegal moves and enforce turn order and
  clocks, but it cannot detect "a human didn't actually think for 3 seconds
  here" from a legal move alone. Mitigation: this is inherent to any
  turn-based online game; consider client + server-side move-time analytics
  later (flag statistically implausible average think-time) — not implemented
  in this MVP, see `docs/ROADMAP.md`.
- **Campaign (Vượt ải) results specifically.** The on-device AI (Maia via
  ONNX) runs entirely on the client, so the server has no way to confirm the
  AI's half of the submitted move list is what the model actually played —
  only that the *entire* move sequence is legal chess reaching a position that
  satisfies the level's win condition (`validateCampaignSubmission`). A
  sufficiently motivated user could fabricate a full fake game client-side.
  Mitigations already in place: every submission is re-simulated move-by-move
  (not trusted as a claimed result), a `suspicious` flag is set when the
  claimed duration is implausibly short for the move count, and every attempt
  (not just successful ones) is logged to `level_replays` for later review.
  Full protection would require running the AI model server-side too, which
  conflicts with the "keep it simple/lightweight" goal for an MVP — flagged
  here explicitly rather than silently left unprotected.
- **A rooted device / modified client lying about which color it's playing,
  disconnecting the instant it's about to lose, etc.** All handled at the
  protocol level (server always knows your real color from the room, and
  `forfeitByAbandon` closes the "disconnect to avoid a loss" loophole), but a
  determined attacker can still e.g. force-kill the app process. The
  reconnect grace period bounds the damage (auto-forfeit after
  `RECONNECT_GRACE_MS`) rather than leaving the opponent stuck waiting forever.
- **Rate-limit evasion via many accounts.** Per-user limits don't stop someone
  from creating many Supabase accounts. Not addressed in this MVP; would need
  device/IP-based signals or Supabase Auth's own abuse controls.

## Best practices to reduce the remaining risk (recommended, not all implemented)

- Turn on Supabase Auth's built-in rate limiting and email/CAPTCHA verification
  for sign-up if abuse becomes a problem.
- Consider certificate pinning in the Flutter app for the Socket.IO/HTTPS
  connection — raises the bar against traffic interception, though it does not
  stop a rooted-device attacker; document as "raises cost" not "solves it".
- Periodically review `level_replays` rows where `suspicious = true` and
  `chat_logs` / `spectator_logs` for abuse patterns.
- If campaign integrity becomes important enough, move Maia inference
  server-side for a subset of "verified" levels (tradeoff: cost, latency,
  and losing the offline-play benefit of an on-device model).
