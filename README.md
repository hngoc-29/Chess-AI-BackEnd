# Chess Online Backend

Server-authoritative realtime backend for the **King's Gambit AI** Flutter chess app:
ranked 1v1 matchmaking, custom rooms, spectators, campaign (Vượt ải) validation, PGN
replay, and Supabase-backed auth/persistence. Node.js + TypeScript + Socket.IO +
Express + chess.js, designed to run as a single small container.

This repo is **backend only**. It does not touch the Flutter app in `/game`.

## Why the server, not the client, decides everything

Every rule in this codebase follows one principle: **the client sends intents, the
server decides facts.** The client says "I want to move e2→e4"; only the server
(via `chess.js` inside `GameRoom`) decides whether that's legal, whose turn it is,
what the resulting position is, whether it's checkmate, and what the clock reads.
See `docs/SECURITY.md` for the full checklist of what this does and doesn't protect
against.

## Project layout

```
src/
  config/env.ts            Validated environment config (fails fast on boot)
  db/supabase.ts           Two Supabase clients: service-role (admin) + anon (auth check only)
  auth/                    JWT verification + profile bootstrap
  engine/                  Core game logic — GameRoom, GameClock, MatchmakingQueue, Elo, RoomManager
  campaign/                Campaign level definitions + server-side replay validation
  socket/                  Socket.IO auth middleware, event constants, and per-feature handlers
  routes/                  REST endpoints (profile, match history/replay, campaign)
  services/                Persistence — writes finished matches/campaign results to Supabase
  middleware/               Rate limiting, error handling
  utils/                   Logger, zod validation schemas
sql/schema.sql             Full Postgres schema for Supabase (tables, indexes, RLS)
docs/SOCKET_EVENTS.md      Client<->server Socket.IO event contract
docs/SECURITY.md           Anti-cheat / security checklist and known limitations
docs/ROADMAP.md            Suggested next features and extension points
```

## 1. Supabase setup

1. Create a Supabase project.
2. Open the SQL editor and run `sql/schema.sql` in full.
3. In **Project Settings → API**, copy:
   - `Project URL` → `SUPABASE_URL`
   - `anon public` key → `SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (**server-only, never ship this in the app**)
4. In **Authentication → Providers**, enable the sign-in methods you want (email,
   Google, Facebook, ...). The Flutter app talks to Supabase Auth directly to get an
   access token; this backend only ever *verifies* that token, it never handles
   passwords or OAuth flows itself.

## 2. Run locally

```bash
cp .env.example .env
# fill in SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY

npm install
npm run dev        # tsx watch — auto-restarts on change, http://localhost:8080
```

Sanity check:

```bash
curl http://localhost:8080/health
# {"status":"ok","uptimeSec":1.2,"totalRooms":0,"activeRooms":0}
```

`npm run typecheck` and `npm run build` are also available (`build` outputs to `dist/`).

### Connecting a Socket.IO client (for manual testing)

```js
const socket = io("http://localhost:8080", {
  auth: { token: SUPABASE_ACCESS_TOKEN }, // from supabase.auth.currentSession
});
socket.on("connect_error", (err) => console.log("auth rejected:", err.message));
```

See `docs/SOCKET_EVENTS.md` for the full event list and payloads.

## 3. Deploy to Hugging Face Spaces (Docker)

1. Create a new Space → **Docker** SDK → any hardware tier (CPU basic is enough to start).
2. Push this repo's contents to the Space's git remote (HF Spaces are just git repos):
   ```bash
   git remote add hf https://huggingface.co/spaces/<your-username>/<space-name>
   git push hf main
   ```
3. In the Space's **Settings → Repository secrets**, add:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `CORS_ORIGINS` (set to your real origins once you have a web build; `*` while testing)
4. HF Spaces (Docker SDK) routes external traffic to **port 7860** — the `Dockerfile`
   already sets `ENV PORT=7860` and `EXPOSE 7860` to match, so no changes needed there.
5. The Space needs a `README.md` at the repo root with YAML front matter telling HF
   it's a Docker Space (if you're pushing this project's own README, add this block
   to the very top of it before pushing):
   ```yaml
   ---
   title: Chess Online Backend
   emoji: ♟️
   sdk: docker
   app_port: 7860
   ---
   ```
6. Push — the Space will build the `Dockerfile` and start the container. Watch the
   **Logs** tab for the `🚀 chess-online-backend listening on port 7860` line.

### Important operational caveat for HF Spaces specifically

Live rooms live in the process's RAM (`RoomManager`), not in Supabase. **If the Space
restarts or sleeps while a game is in progress, that game's in-memory state is lost**
(finished matches already written to Supabase are safe — only the live, unfinished
game is at risk). Free-tier Spaces can sleep after inactivity and can restart when you
push updates. For a backend meant to hold real-time games:
- Prefer an always-on (non-sleeping) Space tier if you expect concurrent live games.
- Treat any deploy/restart as "kicks everyone's active game" until horizontal
  state-sharing (Redis, sticky sessions, etc.) is added — see `docs/ROADMAP.md`.

## Environment variables

See `.env.example` for the full list with defaults. The server refuses to boot if
`SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` are missing or
malformed — this is intentional (fail fast rather than run half-configured).
