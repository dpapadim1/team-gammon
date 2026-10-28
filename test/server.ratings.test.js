import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { MIGRATIONS, Store, migrate, openStore } from '../server/db.js';
import { HttpClient, TestSocket, autoPlay, startTestServer } from '../testkit/server.js';

const ok = (res, what = '') => assert.equal(res.ok, true, `${what} ${JSON.stringify(res)}`);

async function withServer(t, overrides) {
  const srv = await startTestServer(overrides);
  t.after(() => srv.close());
  return srv;
}

async function human(baseUrl, name) {
  const http = new HttpClient(baseUrl);
  const user = name ? await http.register(name) : await http.guest();
  const ws = await new TestSocket(baseUrl, http.cookie).ready();
  return { http, ws, user };
}

const gameInfo = { roomId: 'room1234', variant: 'v', cycle: ['t1', 'b1', 't2', 'b2'], firstSlot: 0, startedAt: 1, timeMinutes: 15, incrementSec: 5, seats: {} };

test('store: a version-1 database keeps its data when it is upgraded to ratings', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(MIGRATIONS[0]);
  db.pragma('user_version = 1');
  db.prepare("INSERT INTO users (id, username, pass_hash, created_at) VALUES (1, 'old_timer', 'x', 1)").run();
  db.prepare("INSERT INTO games (id, room_id, variant, cycle, first_slot, started_at, time_minutes, increment_sec, seats, ended_at, winner_team, reason) VALUES (7, 'room1234', 'v', '[]', 0, 1, 15, 5, '{}', 2, 0, 'bearoff')").run();
  db.prepare("INSERT INTO game_players (game_id, user_id, seat) VALUES (7, 1, 't1')").run();

  migrate(db);
  const store = new Store(db);
  assert.equal(db.pragma('user_version', { simple: true }), MIGRATIONS.length);
  assert.deepEqual(store.ratingOf(1), { rating: 1200, games: 0, wins: 0 }, 'existing players start at the default');
  const [old] = store.gamesOfUser(1);
  assert.equal(old.id, 7);
  assert.equal(old.ratingBefore, null, 'games from before ratings have no rating change');
  assert.equal(store.ratingOf(99), null, 'unknown users have no rating');
});

test('store: ratings add up per player, the leaderboard ranks them and deleting an account removes the rating', () => {
  const store = openStore();
  const amy = store.createUser('amy', 'h');
  const ben = store.createUser('ben', 'h');
  const cy = store.createUser('cy', 'h');
  const players = [{ userId: amy, seat: 't1' }, { userId: ben, seat: 'b1' }];
  const finishedGame = () => {
    const id = store.startGame(gameInfo, players);
    store.finishGame(id, { endedAt: 5, winnerTeam: 0, reason: 'bearoff', history: [], finalPosition: 'x' });
    return id;
  };
  const first = finishedGame();
  store.saveRatings(first, [
    { userId: amy, seat: 't1', before: 1200, after: 1219.6, won: true },
    { userId: ben, seat: 'b1', before: 1200, after: 1180.4, won: false },
  ], 10);
  const second = finishedGame();
  store.saveRatings(second, [
    { userId: amy, seat: 't1', before: 1219.6, after: 1238, won: true },
    { userId: ben, seat: 'b1', before: 1180.4, after: 1190, won: true },
  ], 20);

  assert.deepEqual(store.ratingOf(amy), { rating: 1238, games: 2, wins: 2 });
  assert.deepEqual(store.ratingOf(ben), { rating: 1190, games: 2, wins: 1 });
  assert.deepEqual(store.ratingOf(cy), { rating: 1200, games: 0, wins: 0 });

  assert.deepEqual(store.leaderboard(), [
    { rank: 1, name: 'amy', rating: 1238, games: 2, wins: 2, provisional: true },
    { rank: 2, name: 'ben', rating: 1190, games: 2, wins: 1, provisional: true },
  ]);
  assert.equal(store.leaderboard({ limit: 1 }).length, 1);
  assert.equal(store.standingOf(ben).rank, 2);
  assert.equal(store.standingOf(cy), null, 'players without a rated game are not ranked');

  const [latest] = store.gamesOfUser(amy);
  assert.equal(latest.ratingBefore, 1220);
  assert.equal(latest.ratingAfter, 1238);

  store.deleteUser(amy);
  assert.deepEqual(store.leaderboard().map((p) => p.name), ['ben'], 'the rating goes with the account');
  assert.equal(store.ratingOf(amy), null);
  assert.equal(store.standingOf(ben).rank, 1);
});

// One game against level-1 bots in the remaining seats, played by the given people with random legal turns.
async function playRated(t, { names, seats }) {
  const srv = await withServer(t);
  const players = [];
  for (const [i, name] of names.entries()) players.push({ ...(await human(srv.baseUrl, name)), seat: seats[i] });
  const created = await players[0].ws.emit('room:create', { name: 'rated' });
  ok(created, 'create');
  for (const p of players.slice(1)) ok(await p.ws.emit('room:join', { roomId: created.roomId }), 'join');
  for (const p of players) ok(await p.ws.emit('seat:claim', { seat: p.seat }), 'claim');
  ok(await players[0].ws.emit('bot:fill', { level: 1 }), 'fill');
  for (const p of players) autoPlay(p.ws, p.seat);
  for (const p of players) ok(await p.ws.emit('seat:ready', { ready: true }), 'ready');
  const over = await players[0].ws.waitState((s) => s.phase === 'over', 60000);
  return { ...srv, players, over };
}

test('a rated game moves the rating of a registered player and shows up everywhere', async (t) => {
  const { baseUrl, players, over } = await playRated(t, { names: ['alice'], seats: ['t1'] });
  const [alice] = players;
  const result = over.game.result;
  assert.equal(result.reason, 'bearoff');
  // Alice and a level-1 bot (800) against two level-1 bots: 1000 against 800, so she is the favourite (K 40).
  const won = result.winnerTeam === 0;
  assert.deepEqual(result.ratings, { t1: { before: 1200, after: won ? 1210 : 1170 } });
  assert.equal(over.seats.t1.rating, result.ratings.t1.after, 'the seat shows the new rating');

  assert.equal((await alice.http.get('/api/me')).json.user.rating, result.ratings.t1.after);
  const games = (await alice.http.get('/api/games')).json.games;
  assert.equal(games[0].ratingBefore, 1200);
  assert.equal(games[0].ratingAfter, result.ratings.t1.after);

  const board = (await alice.http.get('/api/leaderboard')).json;
  assert.deepEqual(board.players, [{ rank: 1, name: 'alice', rating: result.ratings.t1.after, games: 1, wins: won ? 1 : 0, provisional: true }]);
  assert.deepEqual(board.me, board.players[0]);

  const anonymous = await new HttpClient(baseUrl).get('/api/leaderboard');
  assert.equal(anonymous.status, 200, 'the leaderboard is public');
  assert.equal(anonymous.json.me, undefined);
  assert.equal(anonymous.json.players.length, 1);
});

test('two registered players on opposite teams gain and lose the same amount', async (t) => {
  const { players, over } = await playRated(t, { names: ['alice', 'bobby'], seats: ['t1', 'b1'] });
  const [alice, bobby] = players;
  const { ratings, winnerTeam } = over.game.result;
  // Each team is one new player and one level-1 bot, so the teams are even and K is 40: plus or minus 20.
  assert.deepEqual(ratings, { t1: { before: 1200, after: winnerTeam === 0 ? 1220 : 1180 }, b1: { before: 1200, after: winnerTeam === 1 ? 1220 : 1180 } });
  const board = (await alice.http.get('/api/leaderboard')).json.players;
  assert.deepEqual(board.map((p) => p.name), winnerTeam === 0 ? ['alice', 'bobby'] : ['bobby', 'alice']);
  assert.equal((await bobby.http.get('/api/me')).json.user.rating, ratings.b1.after);
});

test('guests are not rated, and neither are games that end too early', async (t) => {
  const { baseUrl, players, over } = await playRated(t, { names: [undefined], seats: ['t1'] });
  assert.equal(over.game.result.ratings, undefined, 'a guest game changes nobody');
  assert.equal(over.seats.t1.rating, undefined);
  assert.equal((await players[0].http.get('/api/leaderboard')).json.players.length, 0);
  assert.equal((await players[0].http.get('/api/me')).json.user.rating, undefined);

  const early = await human(baseUrl, 'quitter');
  ok(await early.ws.emit('room:create', {}));
  ok(await early.ws.emit('seat:claim', { seat: 't1' }));
  ok(await early.ws.emit('bot:fill', { level: 1 }));
  ok(await early.ws.emit('seat:ready', { ready: true }));
  await early.ws.waitState((s) => s.phase === 'playing');
  ok(await early.ws.emit('game:resign', {}));
  const over2 = await early.ws.waitState((s) => s.phase === 'over');
  assert.equal(over2.game.result.reason, 'resign');
  assert.equal(over2.game.result.ratings, undefined, 'giving up before eight turns is not rated');
  assert.equal((await early.http.get('/api/me')).json.user.rating, 1200);
  assert.equal((await early.http.get('/api/leaderboard')).json.players.length, 0);
});
