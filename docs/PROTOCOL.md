# Team Gammon: network protocol

Protocol version 1. The server is authoritative: it rolls the dice, validates every turn with the shared rules engine in `engine/`, runs the clocks and decides results. Clients send intentions and render the `state` they receive.

## 1. Accounts over HTTP

All requests and responses are JSON. Errors are `{ "error": "<code>" }`. State-changing requests must be same-origin (an `Origin` header, when present, has to match the host or `ALLOWED_ORIGINS`) and the session cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production.

| Request | Body | Success | Errors |
|---|---|---|---|
| `GET /ping` | | `200 pong` | |
| `POST /api/register` | `{username, password}` | `201 {user}` and a session | `400 bad_username`, `400 bad_password`, `409 username_taken` |
| `POST /api/login` | `{username, password}` | `200 {user}` | `401 invalid_credentials` |
| `POST /api/guest` | `{}` | `201 {user}` (guest, no password) | |
| `POST /api/logout` | | `204`, sockets of that user are closed | |
| `GET /api/me` | | `200 {user}` | `401 auth_required` |
| `DELETE /api/me` | `{password}` (registered users) | `204`, account and personal data removed | `401 invalid_credentials` |
| `GET /api/rooms` | | `200 {rooms: [RoomSummary]}` public rooms only | `401` |
| `GET /api/leaderboard?limit=50` | | `200 {players: [Standing], me?: Standing}` public, 1-100 players by rating; `me` is the caller's own standing when signed in with a rated game | |
| `GET /api/games?limit=20&before=<id>` | | `200 {games: [GameSummary]}` finished games of a registered user | `401`, `403 guests_have_no_history` |
| `GET /api/games/:id` | | `200 {game}` including the replayable `history` | `403`, `404 not_found` |

Usernames: 3-20 characters of `A-Z a-z 0-9 _`; names that start with `guest`, `admin`, `root`, `system`, `support` or `bot` are reserved. Passwords: 8-128 characters. Any request can also fail with `429 rate_limited`.

`user` is `{id, username, guest}`, plus `rating` (rounded) for registered players on `/api/register`, `/api/login` and `/api/me`. Ids look like `u:12` (registered) and `g:9f3c...` (guest). `Standing` is `{rank, name, rating, games, wins, provisional}` (`provisional` while fewer than 20 rated games). A `GameSummary` also has `ratingBefore` and `ratingAfter`, which are `null` for games that were not rated.

## 2. Realtime over socket.io

Connect to the same origin with the session cookie. A connection without a valid session is refused with `connect_error` message `auth_required`. Every client request uses an acknowledgement callback and gets `{ok: true, ...}` or `{ok: false, error, message?}`.

On connect the server sends `hello`:

```json
{ "protocol": 1, "serverTime": 1730000000000, "user": {"id": "g:ab12", "username": "Guest-4821", "guest": true},
  "rules": { "id": "quadrant-plakoto-4p", "numPoints": 24, "homeSize": 6, "checkersPerSeat": 8, "startSanctuary": true,
             "seats": [{"id": "t1", "team": 0, "start": 24, "dir": -1}, "..."] },
  "botLevels": {"1": "Beginner", "2": "Novice", "...": "..."},
  "botRatings": {"1": 800, "2": 947, "...": "..."} }
```

If the user still holds a seat in a game that is running, the server rejoins them to that room automatically and sends `state` right after `hello`. Leaving a room when no game is running frees the seat.

### 2.1 Client requests

| Event | Payload | Notes |
|---|---|---|
| `room:create` | `{name?, visibility?: "public"\|"private", timeMinutes?: 1-120, incrementSec?: 0-60}` | creator joins as host; returns `{roomId}` |
| `room:join` | `{roomId}` | joins as spectator; fails with `in_game` while you hold a seat in a running game elsewhere |
| `room:leave` | `{}` | `in_game` while seated in a running game: resign first |
| `room:settings` | `{name?, visibility?, timeMinutes?, incrementSec?}` | host, lobby only |
| `seat:claim` | `{seat}` | lobby only; one seat per user; takes a free seat or replaces a bot; moving to another free seat is allowed |
| `seat:release` | `{seat}` | lobby only |
| `seat:ready` | `{ready: boolean}` | lobby only |
| `bot:set` | `{seat, level: 1-9\|null}` | host, lobby only; `null` empties a bot seat; a human seat cannot be changed |
| `bot:fill` | `{level}` | host, lobby only; fills every empty seat |
| `turn:play` | `{steps: [[from, die], ...]}` | a complete legal turn, see 2.3 |
| `suggest:set` | `{steps}` | teammate of the player on turn; shown only to that team |
| `suggest:clear` | `{}` | |
| `chat:send` | `{text, channel: "all"\|"team"}` | 1-300 characters; `team` needs a seat |
| `game:resign` | `{}` | seated player; the player's team loses |
| `game:rematch` | `{}` | after a game: back to the lobby with the same seats |

The game starts by itself when all four seats are taken, at least one is human, and every human is ready and connected. Bots are always ready.

### 2.2 Server events

- `state`: the complete room snapshot (below). Sent to every member after every change. Ignore a snapshot whose `version` is not higher than the last one you applied.
- `chat`: `{id, ts, from: {name, seat}, channel, text}`.
- `chat:history`: `{messages: [...]}` the recent messages visible to you, sent when you join.

```json
{
  "version": 41, "serverTime": 1730000000000,
  "room": {"id": "k3m9x2ab", "name": "Friday game", "visibility": "public", "host": "alice", "timeMinutes": 15, "incrementSec": 5},
  "phase": "lobby" | "playing" | "over",
  "seats": {"t1": Seat | null, "b1": Seat | null, "t2": Seat | null, "b2": Seat | null},
  "spectators": 2,
  "you": {"seat": "t1" | null, "host": true, "suggestions": [{"seat": "t2", "steps": [[24, 6], [18, 1]], "turnNumber": 17}]},
  "game": Game | null
}
```

`Seat` is `{kind: "human"|"bot", name, ready, connected, level?, rating?}`; `rating` is the rounded rating of a registered human. `Game` is present while playing and after the game:

```json
{
  "variant": "quadrant-plakoto-4p", "reversed": false, "cycle": ["t1", "b1", "t2", "b2"],
  "position": "b1:8/././././b2:8/./././././././././t2:8/./././././t1:8 0,0,0,0",
  "turnNumber": 17, "slot": 1, "slotSeat": "b1", "actor": "b1",
  "dice": [4, 2], "target": 2, "forcedDie": null,
  "last": {"actor": "t1", "slotSeat": "t1", "dice": [6, 1], "steps": [[24, 6, 18], [18, 1, 17]], "passed": false},
  "clocks": {"pools": [900000, 900000], "running": 1, "asOf": 1730000000000},
  "result": null | {"winnerTeam": 0, "reason": "bearoff"|"timeout"|"resign"|"deadlock"|"error", "ratings"?: {"t1": {"before": 1200, "after": 1210}}},
  "gameId": 1234
}
```

- `position` uses the text form of the engine (`Position.toText()`): 24 points separated by `/`, then the borne-off count of each seat in seat order. A token `t1:3` is three checkers of t1, `!` marks the pinned checker.
- `dice` is `null` between turns. While it is set, `actor` is the seat that must play (a finished seat's slot is played by its teammate, so `actor` can differ from `slotSeat`). `target` is how many dice must be used.
- `last.steps` are `[from, die, to]` where `to` is `0` for a checker borne off. A pass has `steps: []` and `passed: true`.
- `clocks.pools` are milliseconds left at `asOf`; the team in `running` (0 Top, 1 Bottom) is being charged. The clock only runs while a human is on turn. A client shows `pools[running] - (now - asOf)` with its own clock offset taken from `serverTime`.
- `winnerTeam` is `0` (Top), `1` (Bottom) or `-1` (draw). `error` is a draw caused by an internal failure. Stored games can also have the reason `abandoned` (the server restarted or the room disappeared mid-game).
- `result.ratings` is present when the game was rated (section 3): one `{before, after}` entry per registered human seat, keyed by seat id.

### 2.3 Playing a turn

Rolls are made by the server: when `dice` appears and `actor` is your seat, send `turn:play` with the steps in the order you want them applied. `[from, die]` moves one checker of your seat from point `from` by `die` points in your direction (or off the board). The client can find legal steps with the engine (`legalNextSteps`) from `position`, `actor` and `dice`; the server re-validates everything and answers `{ok:false, error:"illegal_turn"}` if the turn is not a complete legal turn. A turn with no legal move is passed by the server automatically.

### 2.4 Error codes

`rate_limited`, `internal` (any request); `bad_request` (payload is not an object or a field has the wrong type), `bad_room`, `bad_seat`, `bad_steps`, `bad_text`, `bad_channel`, `bad_level`, `bad_settings` (malformed input); `no_room`, `room_full`, `too_many_rooms` (rooms); `seat_taken`, `no_seat`, `human_seat` (seats); `not_host`, `not_lobby`, `no_game`, `game_over`, `in_game` (wrong moment or rights); `not_your_turn`, `illegal_turn` (turns and suggestions). The connection itself is refused with `auth_required` (no session) or `too_many_connections` (more than 8 open sockets for the account).

## 3. Ratings

Registered players have a rating that starts at 1200. A game is rated when it ends by `bearoff`, `timeout`, `resign` or `deadlock` after at least 8 turns and has a registered player; guests and bots are never updated. A team counts as the mean rating of its two seats: bots use a fixed rating per level (`botRatings` in `hello`) and guests count as 1200. The expected score is `1 / (1 + 10^((other - own) / 400))` and every registered player moves by `K * (score - expected)`, with score 1 for a win, 0.5 for a draw and 0 for a loss. K is 40 for the first 20 rated games, then 24, and 16 from a rating of 1800. The new ratings arrive in `game.result.ratings` when the game ends.

## 4. Security notes for clients

- Render names and chat with `textContent`, never as HTML. The server strips control characters and trims whitespace but does not escape.
- Do not trust or send usernames in event payloads: identity comes from the session only.
- The native app will use a token handshake instead of cookies; the event protocol stays identical.
