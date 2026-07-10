# Socket.IO Event Contract

All event names live in `src/socket/events.ts` (`ClientEvents` / `ServerEvents`) —
treat that file as the source of truth if this doc drifts.

## Connecting

```js
const socket = io("https://your-backend", {
  auth: { token: supabaseAccessToken },
});
```

If the token is missing or invalid, the connection is rejected with a
`connect_error` whose `message` is `UNAUTHENTICATED`, `INVALID_TOKEN`, or
`AUTH_ERROR` — the socket never reaches `connection` and no game event handlers
are registered for it.

Most client→server events accept an **ack callback** as the last argument:
`socket.emit(EVENT, payload, (res) => { ... })`, where `res` is either
`{ ok: true, ...data }` or `{ ok: false, error: string, code？: string }`.
Use the ack for immediate request/response feedback; use the corresponding
`ServerEvents` broadcast for state that should update all participants (both
players + spectators) at once.

---

## Matchmaking (ranked)

### `queue:join` (client → server)
```json
{ "timeControlMinutes": 10, "incrementSeconds": 5 }
```
Ack: `{ "ok": true }` or `{ "ok": false, "error": "You already have an active game." }`

### `queue:leave` (client → server)
No payload.

### `queue:joined` (server → client)
```json
{ "timeControlKey": "600+5" }
```

### `match:found` (server → client, sent to both matched players)
```json
{
  "room": { "roomId": "aBc123XyZ0", "status": "active", "fen": "...", "turn": "w", "...": "..." },
  "yourColor": "w"
}
```

### `queue:timeout` (server → client)
```json
{ "message": "No opponent found in time. Please try again." }
```

---

## Custom rooms

### `room:create` (client → server)
```json
{
  "timeControlMinutes": 10,
  "incrementSeconds": 5,
  "allowSpectators": true,
  "maxSpectators": 50,
  "password": null,
  "rated": false
}
```
Ack: `{ "ok": true, "code": "K7X2QP" }`

### `room:join` (client → server)
```json
{ "code": "K7X2QP", "password": "optional" }
```
Ack (joiner): `{ "ok": true, "room": { ... }, "yourColor": "b" }`
Server also emits `room:joined` to the **host's** socket with their color.

### `room:rematch_request` / `room:rematch_respond` (client → server)
```json
{ "roomId": "aBc123XyZ0" }
```
```json
{ "roomId": "aBc123XyZ0", "accept": true }
```
On accept, both sockets receive a fresh `match:found` for the new room (colors swapped).

### `room:error` (server → client)
```json
{ "code": "ROOM_ERROR", "message": "..." }
```

---

## Spectator

### `spectate:join` (client → server)
```json
{ "roomId": "aBc123XyZ0" }
```
Ack: `{ "ok": true, "room": { ... }, "moves": [ /* MoveRecord[] */ ] }`
Errors: `SPECTATORS_DISABLED`, `SPECTATOR_LIMIT`

### `spectate:leave` (client → server)
```json
{ "roomId": "aBc123XyZ0" }
```

### `spectate:state` (server → room, includes players)
```json
{ "spectatorCount": 4 }
```

Spectators join the same Socket.IO room as players and receive `game:*` broadcasts
(state, moves, game over) — there is no hidden information in chess, so spectators
simply never get a socket that can emit `game:move`.

---

## Gameplay

### `game:move` (client → server)
```json
{
  "roomId": "aBc123XyZ0",
  "from": "e2",
  "to": "e4",
  "promotion": null,
  "expectedMoveIndex": 0,
  "clientTimestamp": 1730000000000
}
```
Ack success: `{ "ok": true, "move": { "index": 0, "san": "e4", "fen": "...", "whiteTimeLeftMs": 599000, "blackTimeLeftMs": 600000, "...": "..." } }`
Ack failure: `{ "ok": false, "error": "It is not your turn.", "code": "NOT_YOUR_TURN" }`

Errors: `ROOM_NOT_ACTIVE`, `NOT_A_PLAYER`, `NOT_YOUR_TURN`, `STALE_MOVE_INDEX`,
`FLAGGED`, `ILLEGAL_MOVE`

### `game:resign` / `game:draw_offer` (client → server)
```json
{ "roomId": "aBc123XyZ0" }
```

### `game:draw_respond` (client → server)
```json
{ "roomId": "aBc123XyZ0", "accept": true }
```
Errors: `NO_PENDING_OFFER`

### `game:sync_request` (client → server)
Use after a reconnect to pull full authoritative state instead of trusting local cache.
```json
{ "roomId": "aBc123XyZ0" }
```
Ack: `{ "ok": true, "room": { ... }, "moves": [ ... ] }`

### `game:state` (server → room)
Full `GameRoom.publicState()` snapshot — sent after connect/reconnect, draw offers,
and disconnect/reconnect of either player.

### `game:move_applied` (server → room)
```json
{ "roomId": "aBc123XyZ0", "move": { "...": "MoveRecord" }, "state": { "...": "publicState()" } }
```

### `game:over` (server → room)
```json
{
  "roomId": "aBc123XyZ0",
  "result": { "resultType": "checkmate", "winnerColor": "w" },
  "pgn": "1. e4 e5 2. ...",
  "finalFen": "..."
}
```
`resultType` is one of: `checkmate`, `resign`, `timeout`, `stalemate`,
`draw_agreement`, `threefold_repetition`, `fifty_move_rule`,
`insufficient_material`, `abandoned`.

### `game:error` (server → client)
```json
{ "code": "ILLEGAL_MOVE", "message": "That move is not legal." }
```

---

## Chat / reactions

### `chat:message` (client → server)
```json
{ "roomId": "aBc123XyZ0", "text": "gg!" }
```
Rate-limited to 3 messages / 2s per user. Ack failure: `{ "ok": false, "error": "Slow down — sending messages too fast." }`

### `chat:reaction` (client → server)
```json
{ "roomId": "aBc123XyZ0", "emoji": "👍" }
```
Allowed emoji set: `👍 👏 😮 😂 😢 🔥` (validated server-side, not free text).

### `chat:message_received` / `chat:reaction_received` (server → room)
```json
{ "roomId": "aBc123XyZ0", "userId": "uuid", "displayName": "Alice", "text": "gg!", "sentAt": 1730000000000 }
```

---

## Error codes reference

| Code | Meaning |
|---|---|
| `UNAUTHENTICATED` / `INVALID_TOKEN` / `AUTH_ERROR` | Connection-level auth failure (see `connect_error`) |
| `ROOM_NOT_ACTIVE` | Action attempted on a room that hasn't started or already finished |
| `NOT_A_PLAYER` | Caller is not one of the two players in this room |
| `NOT_YOUR_TURN` | It's the opponent's turn |
| `STALE_MOVE_INDEX` | Client's `expectedMoveIndex` doesn't match server state — resync via `game:sync_request` |
| `FLAGGED` | Time ran out for the mover's side before the move was accepted |
| `ILLEGAL_MOVE` | Move rejected by chess.js rules validation |
| `NO_PENDING_OFFER` | Responded to a draw offer that doesn't exist / isn't for this player |
| `SPECTATORS_DISABLED` | Room owner disabled spectating |
| `SPECTATOR_LIMIT` | Room's spectator cap reached |
| `RATE_LIMITED` (HTTP) | Too many REST requests in the current window |
