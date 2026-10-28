# Team Gammon

Four-player team backgammon with Plakoto-style pins: two teams of two, 8 checkers per player, first team to bear off all 16 wins. Rules: [docs/RULES.md](docs/RULES.md). Network protocol: [docs/PROTOCOL.md](docs/PROTOCOL.md).

| Folder | Purpose |
|---|---|
| `engine/` | Rules engine in dependency-free ES modules (runs in Node and the browser) |
| `bots/` | Bot interface, random and heuristic bots, the value network and its bot, difficulty levels, batch runner |
| `server/` | Express and socket.io server: accounts, rooms, game loop, clocks, chat, ratings |
| `client/` | Web client: vanilla ES modules and an SVG board, served by the server at `/` (rules page at `/rules`, interactive tutorial at `/tutorial`, puzzles at `/puzzles`, leaderboard at `/leaderboard`, privacy policy, terms and cookie policy at `/privacy`, `/terms` and `/cookies`) |
| `tools/` | Simulation, variant explorer, opening-safety, self-play data and arena scripts |
| `train/` | PyTorch trainer of the value network (TD(lambda) self-play loop) |
| `test/`, `testkit/` | Tests and an independent, deliberately naive reference implementation |
| `e2e/` | Browser end-to-end script (Microsoft Edge through `playwright-core`) |
| `mobile/` | iOS app (Capacitor): offline games against the bots, tutorial, puzzles and rules bundled; online play opens team-gammon.com in the app. See [mobile/README.md](mobile/README.md) |

Requires Node 22 or newer.

```
npm.cmd install                               # on Windows PowerShell where npm.ps1 is blocked
npm start                                     # server on http://localhost:3000
node --test                                   # run the whole test suite
npm run e2e                                   # play real games in a headless browser, screenshots in e2e/out/
npm run e2e -- puzzlePage tutorial            # only the named scenarios
node tools/sim.mjs --games 1000 --top heuristic --bottom random
node tools/explore.mjs --games 400            # compare layouts and checker counts
node tools/safety.mjs                         # opening exposure per layout
```

## Neural-network bots

Bot levels 8 and 9 play a value network that learned by playing against itself. It lives in `models/champion.json`, which the server reads when the first bot of that level is created; without the file those levels play like level 7.

| Part | What it does |
|---|---|
| `bots/features.js` | Turns a position into network inputs from the point of view of the team that has just moved. The board is mirrored for the Bottom team, so one network serves both sides |
| `bots/nn.js` | The network in plain JavaScript, the bot that plays the turn with the best value, and an optional two-ply search |
| `tools/selfplay.mjs` | Plays games in worker threads and writes every position as training data |
| `tools/arena.mjs` | Bot against bot with a 95% interval, e.g. `node tools/arena.mjs --a net:models/champion.json --b heuristic --games 2000` |
| `train/` | The PyTorch trainer: TD(lambda) targets, the self-play loop and champion gating |

The network estimates the chance that the team that has just moved wins. A first round of games by the heuristic bot teaches it what a position is worth. After that it plays itself: every round fits the network to TD(lambda) targets of the latest games, measures it in the arena against the heuristic bot and against the champion, and a candidate only replaces the champion when it wins at least 52% of the games between them. Runs are kept in a folder that git ignores and can be stopped and resumed.

The shipped network was trained in about an hour on a GTX 1660 Ti: 100,000 heuristic games, then ten rounds of 40,000 self-play games. Strength measured in the arena, with the seats swapped every game:

| Match | Win rate of the first bot (95% interval) |
|---|---|
| Network without randomness against the heuristic bot (level 7), 2000 games | 71.9% (69.8% to 73.8%) |
| Level 8 against level 7, 2000 games | 58.5% (56.3% to 60.6%) |
| Level 9 against level 8, 600 games | 68.5% (64.7% to 72.1%) |
| Levels 2 to 7, each against the level below, 1000 games each | 59% to 72% |

Level 9 adds a two-ply search to the same network: it costs about 40 to 80 ms per turn, and with an earlier version of the network it beat the plain network in 55% of 600 games. Against the heuristic bot the network levelled off at about 72% after five rounds, so a bigger network or richer inputs are the next lever, not more of the same games.

```
python -m venv .venv                                               # Python 3.10 or newer
.venv\Scripts\python -m pip install -r train/requirements.txt      # for an NVIDIA GPU install the CUDA wheels from pytorch.org instead
.venv\Scripts\python -m train.loop --run data/selfplay/run1 --hours 2 --publish models/champion.json
npm run test:py                                                    # trainer tests (they start node, so run them from this folder)
```

## Ratings and the leaderboard

Registered players have a team Elo rating that starts at 1200 and moves after every rated game. It shows in the header, on the seats, on the game-over card and on the public leaderboard at `/leaderboard`. A team is as strong as the mean of its two players. Bots have fixed ratings, from 800 for level 1 to 1731 for level 9, chained from the arena win rate of every level against the one below, so a win against a stronger bot is worth more and the ratings of people and bots share one scale. Guests are not rated, and neither are abandoned games, server errors and games shorter than 8 turns. The formula and the K factors are in [docs/PROTOCOL.md](docs/PROTOCOL.md) and the code is [server/ratings.js](server/ratings.js).

## Puzzles

The page at `/puzzles` holds real positions from games the network played against itself, each with one best play for the roll. It serves one puzzle at a time, chosen to match the player's puzzle rating, and lists only the puzzles already served, so nobody browses the whole set and picks the easy ones. A puzzle is solved by playing the best play on the board. The verdict then shows how often that play won when the network played it out, and a weaker play shows what it gives away. There are hints, undo, a "show the best play" button that draws the answer, and a "next puzzle" button that waits until the puzzle has been attempted.

The puzzle rating is separate from the game rating and works like Elo (`puzzleRating`, `rateAttempt` and `pickNext` in [client/js/puzzles.js](client/js/puzzles.js)). A player starts at 1000, with K 48 for the first 20 puzzles and 24 after that, and the rating moves once per puzzle, on the first attempt: 1 point for the best play, half a point for the best play after a hint, none for any other play or for looking at the answer. Puzzles carry no stored rating: it is worked out from the difficulty class (easy 1100, medium 1450, hard 1800), moved by up to 120 points for how clearly the best play wins and by up to 60 for how many plays there are, so the ratings of the shipped set run from 950 to 1905 and can be tuned without generating anything again. The next puzzle is the one not yet served whose rating is nearest to the player's; when all were served, a missed one comes back. Everything, the rating, the first attempt at each puzzle and whether it was solved since without looking at the answer, is kept in the browser only (local storage key `tg.puzzles`), so it does not follow a player to another device and cannot be shown on a leaderboard.

The puzzles are plain data in [client/puzzles.json](client/puzzles.json): per puzzle the position, the dice, every legal play and, for the best few, the share of played-out games the mover's team won. The page and [client/js/puzzles.js](client/js/puzzles.js) need no server code. The best play of each puzzle was found, not guessed:

1. `tools/puzzles.mjs generate` plays self-play games of `models/champion.json` (with 5% random turns for variety) and keeps three positions of every game, right after the dice were rolled.
2. The network ranks the legal plays. A position is dropped when it has fewer than 6 or more than 70 plays, when the game is already decided (the best play's value outside 25% to 85%), or when the network sees no gap between its two best plays.
3. The best three plays are played out 150 times each by the network against itself, every seat included, with the same dice for every candidate. If the leader is not 3 points ahead the position is dropped. The best four are then played out 600 times each. It becomes a puzzle only when the best play wins at least 4 points more often than the second best and the difference is at least two standard errors.
4. The difficulty comes from two measurements: how far the best play is ahead of the second best, and how much win rate the heuristic bot (level 7) gives away with the play it would choose. Easy: the heuristic finds it and it is clearly best. Hard: the heuristic's play loses at least 10 points. Medium: the rest. The theme (pin, block, bearing off, or positional) says what the best play does.
5. `select` leaves out positions where the best play's measured win rate is below 20% or above 90% (the game is decided), then keeps one puzzle per game, a mix of difficulties and themes, the clearest first.

```
node tools/puzzles.mjs generate --games 1500 --workers 13 --seed 5000 --raw data/puzzles-raw.jsonl   # about 40 minutes on 16 threads; appends as it finds
node tools/puzzles.mjs select --raw data/puzzles-raw.jsonl --count 60 --out client/puzzles.json
```

`--opt name=value` changes a setting of the search (see `DEFAULTS` in [tools/lib/puzzles.js](tools/lib/puzzles.js)). The raw file keeps what was measured, so changing the difficulty rule or the count only needs `select` again. The tests check that every shipped puzzle lists exactly the legal plays, with a clearly better first play, that every play can be made with clicks on the board, and that the generator is deterministic.

How sure is a best play? Rolling out 600 games per play leaves a margin of error of about 3 points on each win rate, so the subtle puzzles are the least certain. As a check, the shipped set was solved a second time with fresh dice: all 24 easy puzzles (margins of 14 points and more) passed the whole acceptance test again, and so did 11 of the 21 medium and 11 of the 15 hard ones. In 13 of the other 14 the same play was still ahead when played out once more; the one whose best play flipped was replaced by the next candidate, which was checked the same way. The win rates the page shows after a play are the measured evidence, so a narrow margin is visible.

One puzzle in `client/puzzles.json`, `steps` being `[point, die]` pairs in the order they are played, best play first:

```
{ "id": 1, "seat": "t1", "dice": [5, 1], "reversed": false, "slot": 0, "turn": 33, "position": "<engine text>", "bias": 0.03,
  "plays": [ { "steps": [[24, 5], [19, 1]], "win": 0.707, "nn": 0.624, "n": 600 }, ..., { "steps": [[9, 5], [7, 1]], "nn": 0.422 } ],
  "difficulty": "easy", "themes": ["block"] }
```

`win` is the measured share of played-out games (only the best four plays have it), `nn` the network's own value, and `bias` the mean of `win - nn`, which the page adds to `nn` to estimate the plays that were not played out. The page remembers a puzzle by a hash of its position, dice and seat, so regenerating the set keeps the progress on every puzzle that survives.

Server settings come from environment variables:

| Variable | Meaning |
|---|---|
| `PORT`, `HOST` | listen address, default `3000` on all interfaces |
| `DATA_DIR` | folder of the SQLite database, default `data` |
| `SESSION_SECRET` | required in production, at least 32 characters |
| `TRUST_PROXY` | number of reverse proxies in front (use `1` behind Caddy) |
| `ALLOWED_ORIGINS` | comma-separated extra origins allowed to call the API |
| `NODE_ENV=production` | secure cookies and the production content security policy |

## Deploying

The game ships as its own Docker service ([Dockerfile](Dockerfile), [docker-compose.yml](docker-compose.yml)) that runs beside the Team Chess stack. That stack's Caddy container serves the game's domain over HTTPS; the Team Chess repository describes the DNS and `GAMMON_DOMAIN` side in its `DEPLOY.md`.

```
echo "SESSION_SECRET=$(openssl rand -hex 32)" > .env   # its own secret, not the one of Team Chess
docker compose up -d --build                          # joins the shared teamchess_web network
docker compose ps                                     # "healthy" once /ping answers; the port is only exposed to Caddy
```

The image holds `engine/`, `bots/`, `models/champion.json`, `server/` and `client/`; the SQLite database lives in the `gammon_data` volume, which is the thing to back up. Without the Team Chess stack, create the network first with `docker network create teamchess_web` and put your own reverse proxy on it.
