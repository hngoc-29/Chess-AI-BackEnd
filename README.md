# Chess Online Backend

Server-authoritative realtime backend for the **King's Gambit AI** Flutter chess app:
ranked 1v1 matchmaking, custom rooms, spectators, campaign (Vượt ải) validation, PGN
replay, and JWT-based auth with Turso (LibSQL) persistence. Node.js + TypeScript +
Socket.IO + Express + chess.js, designed to run as a single small container.

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
  config/env.ts             Validated environment config (fails fast on boot)
  db/turso.ts               Turso (LibSQL) client + query/execute/transaction helpers
  auth/                     Password hashing, JWT issue/verify, profile bootstrap
  engine/                   Core game logic — GameRoom, GameClock, MatchmakingQueue, Elo, RoomManager
  campaign/                 Campaign level definitions + server-side replay validation
  socket/                   Socket.IO auth middleware, event constants, and per-feature handlers
  routes/                   REST endpoints (auth, profile, match history/replay, campaign, admin)
  services/                 Persistence — writes finished matches/campaign results to Turso
  middleware/                Rate limiting, error handling, admin role gate
  utils/                    Logger, zod validation schemas
sql/turso-schema.sql       Current LibSQL/SQLite schema (tables, indexes, triggers)
sql/schema.sql              Legacy Postgres/Supabase schema, kept for reference only —
                            not used since the Turso migration (see TURSO_MIGRATION.md)
docs/SOCKET_EVENTS.md      Client<->server Socket.IO event contract
docs/SECURITY.md           Anti-cheat / security checklist and known limitations
docs/ROADMAP.md            Suggested next features and extension points
TURSO_MIGRATION.md         Notes on the Supabase → Turso + JWT migration
```

## 1. Turso + JWT setup

1. Create a [Turso](https://turso.tech) database (`turso db create <name>`), or use
   any LibSQL-compatible server.
2. Run the schema against it: `turso db shell <name> < sql/turso-schema.sql`
   (or `sqlite3 local.db < sql/turso-schema.sql` for local file-based dev).
3. Grab the connection details:
   - `turso db show <name> --url` → `TURSO_DATABASE_URL`
   - `turso db tokens create <name>` → `TURSO_AUTH_TOKEN`
4. Generate two random secrets for `JWT_SECRET` and `JWT_REFRESH_SECRET` (e.g.
   `openssl rand -base64 48`) — these sign the access/refresh tokens issued by
   `POST /api/auth/login` and `POST /api/auth/register`. This backend owns auth
   directly (email + password, hashed with argon2/bcrypt in `src/auth/jwt.ts`);
   there is no third-party auth provider to configure.

## 2. Run locally

```bash
cp .env.example .env
# fill in TURSO_DATABASE_URL / TURSO_AUTH_TOKEN / JWT_SECRET / JWT_REFRESH_SECRET

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
// accessToken comes from POST /api/auth/login (see below)
const socket = io("http://localhost:8080", {
  auth: { token: accessToken },
});
socket.on("connect_error", (err) => console.log("auth rejected:", err.message));
```

```bash
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"..."}'
# -> { user, accessToken, refreshToken }
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
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
   - `JWT_SECRET`
   - `JWT_REFRESH_SECRET`
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

Live rooms live in the process's RAM (`RoomManager`), not in Turso. **If the Space
restarts or sleeps while a game is in progress, that game's in-memory state is lost**
(finished matches already written to Turso are safe — only the live, unfinished
game is at risk). Free-tier Spaces can sleep after inactivity and can restart when you
push updates. For a backend meant to hold real-time games:
- Prefer an always-on (non-sleeping) Space tier if you expect concurrent live games.
- Treat any deploy/restart as "kicks everyone's active game" until horizontal
  state-sharing (Redis, sticky sessions, etc.) is added — see `docs/ROADMAP.md`.

## Environment variables

See `.env.example` for the full list with defaults. The server refuses to boot if
`TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` / `JWT_SECRET` / `JWT_REFRESH_SECRET` are
missing or malformed — this is intentional (fail fast rather than run half-configured).
