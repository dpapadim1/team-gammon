import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, Position, QUADRANT_PLAKOTO_4P, compileVariant, createRng, reverseCycle } from '../engine/index.js';
import { HttpClient, TestSocket, autoPlay, chooseTurnFromState, startTestServer } from '../testkit/server.js';

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

const ok = (res, what = '') => assert.equal(res.ok, true, `${what} ${JSON.stringify(res)}`);
const err = (res, code) => {
  assert.equal(res.ok, false, `expected ${code}, got ${JSON.stringify(res)}`);
  assert.equal(res.error, code);
};

async function soloGame(t, overrides, roomOptions = {}) {
  const srv = await withServer(t, overrides);
  const p = await human(srv.baseUrl, 'alice');
  const room = await p.ws.emit('room:create', { name: 'solo', ...roomOptions });
  ok(room, 'create');
  ok(await p.ws.emit('seat:claim', { seat: 't1' }), 'claim');
  ok(await p.ws.emit('bot:fill', { level: 1 }), 'fill');
  return { ...srv, p, roomId: room.roomId };
}

test('a registered player plays a full game against three bots and it is saved and replayable', async (t) => {
  const { p, server, baseUrl, roomId } = await soloGame(t);
  autoPlay(p.ws, 't1');
  ok(await p.ws.emit('seat:ready', { ready: true }), 'ready');
  const over = await p.ws.waitState((s) => s.phase === 'over', 30000);

  const g = over.game;
  assert.equal(g.result.reason, 'bearoff');
  assert.ok([0, 1].includes(g.result.winnerTeam));
  assert.equal(g.dice, null);
  const rules = compileVariant(QUADRANT_PLAKOTO_4P);
  const final = Position.fromText(rules, g.position);
  assert.equal(final.teamFinished(g.result.winnerTeam), true, 'the winners have borne off everything');
  assert.equal(final.teamFinished(1 - g.result.winnerTeam), false);
  assert.deepEqual(g.last.dice.length, 2);
  assert.equal(over.you.seat, 't1');

  const list = await p.http.get('/api/games');
  assert.equal(list.json.games.length, 1);
  assert.equal(list.json.games[0].seat, 't1');
  assert.equal(list.json.games[0].reason, 'bearoff');
  const detail = (await p.http.get(`/api/games/${g.gameId}`)).json.game;
  assert.equal(detail.roomId, roomId);
  assert.equal(detail.winnerTeam, g.result.winnerTeam);
  assert.equal(detail.seats.t1.name, 'alice');
  assert.equal(detail.seats.b1.kind, 'bot');
  assert.equal(detail.finalPosition, g.position);

  const reversed = detail.cycle[1] === 'b2';
  const replay = Game.replay(detail.history, { variant: reversed ? reverseCycle(QUADRANT_PLAKOTO_4P) : QUADRANT_PLAKOTO_4P, firstSlot: detail.firstSlot });
  assert.equal(replay.position.toText(), detail.finalPosition, 'the stored history replays to the stored final position');
  assert.deepEqual(replay.result(), { winnerTeam: detail.winnerTeam, reason: 'bearoff' });

  const guestStranger = await human(baseUrl);
  assert.equal((await guestStranger.http.get(`/api/games/${g.gameId}`)).status, 403, 'guests cannot read games');
  const stranger = await human(baseUrl, 'stranger_1');
  assert.equal((await stranger.http.get(`/api/games/${g.gameId}`)).status, 403, 'only participants read a game');
  assert.equal((await stranger.http.get('/api/games')).json.games.length, 0, 'and the list holds only their own games');
  assert.equal((await stranger.http.get('/api/games/999999')).status, 404);
  assert.equal(server.store.getGame(g.gameId).endedAt > 0, true);
});

test('lobby rules: host rights, seats, readiness and settings', async (t) => {
  const { baseUrl } = await withServer(t);
  const host = await human(baseUrl, 'hosty');
  const guest = await human(baseUrl);
  const created = await host.ws.emit('room:create', { name: ' Friday   game ', visibility: 'public', timeMinutes: 10, incrementSec: 2 });
  ok(created);
  ok(await guest.ws.emit('room:join', { roomId: created.roomId }));
  const state = await guest.ws.waitState((s) => s.room?.id === created.roomId);
  assert.equal(state.room.name, 'Friday game');
  assert.equal(state.room.host, 'hosty');
  assert.equal(state.phase, 'lobby');
  assert.deepEqual(state.you, { seat: null, host: false, suggestions: [] });
  assert.equal(state.spectators, 2);

  err(await guest.ws.emit('bot:set', { seat: 't2', level: 3 }), 'not_host');
  err(await guest.ws.emit('bot:fill', { level: 3 }), 'not_host');
  err(await guest.ws.emit('room:settings', { timeMinutes: 5 }), 'not_host');

  ok(await host.ws.emit('seat:claim', { seat: 't1' }));
  err(await guest.ws.emit('seat:claim', { seat: 't1' }), 'seat_taken');
  ok(await guest.ws.emit('seat:claim', { seat: 'b1' }));
  err(await host.ws.emit('bot:set', { seat: 'b1', level: 2 }), 'human_seat');
  ok(await host.ws.emit('bot:set', { seat: 't2', level: 3 }));
  ok(await host.ws.emit('bot:set', { seat: 'b2', level: 5 }));
  const withBots = await host.ws.waitState((s) => s.seats.b2?.kind === 'bot');
  assert.deepEqual(withBots.seats.t2, { kind: 'bot', name: 'Easy bot', ready: true, connected: true, level: 3 });
  assert.equal(withBots.seats.b2.level, 5);
  assert.deepEqual(withBots.seats.t1, { kind: 'human', name: 'hosty', ready: false, connected: true, rating: 1200 });

  err(await guest.ws.emit('seat:release', { seat: 't1' }), 'no_seat');
  ok(await guest.ws.emit('seat:release', { seat: 'b1' }));
  ok(await host.ws.emit('bot:set', { seat: 'b1', level: null }), 'an empty seat can be cleared again');
  const cleared = await host.ws.waitState((s) => s.seats.b1 === null && s.seats.t2?.kind === 'bot');
  assert.equal(cleared.seats.t1.name, 'hosty');
  ok(await host.ws.emit('bot:fill', { level: 4 }));
  const full = await host.ws.waitState((s) => s.seats.b1?.kind === 'bot');
  assert.equal(full.seats.b1.name, 'Casual bot');
  assert.equal(full.seats.t2.level, 3, 'fillBots only fills empty seats');
});

test('lobby rules: moving seats, spectators, validation and settings', async (t) => {
  const { baseUrl } = await withServer(t);
  const host = await human(baseUrl, 'hosty');
  const other = await human(baseUrl);
  const { roomId } = await host.ws.emit('room:create', {});
  await other.ws.emit('room:join', { roomId });

  ok(await other.ws.emit('seat:claim', { seat: 'b1' }));
  ok(await other.ws.emit('seat:claim', { seat: 't2' }), 'moving to another free seat releases the old one');
  const s = await other.ws.waitState((x) => x.seats.t2 !== null);
  assert.equal(s.seats.b1, null);
  assert.equal(s.you.seat, 't2');

  err(await host.ws.emit('seat:ready', { ready: true }), 'no_seat');
  ok(await other.ws.emit('seat:ready', { ready: true }));
  ok(await other.ws.emit('seat:ready', { ready: false }));
  err(await other.ws.emit('seat:ready', { ready: 'yes' }), 'bad_request');
  err(await other.ws.emit('seat:claim', { seat: 'x9' }), 'bad_seat');
  err(await host.ws.emit('bot:set', { seat: 't1', level: 10 }), 'bad_level');
  err(await host.ws.emit('bot:fill', {}), 'bad_level');
  err(await host.ws.emit('room:join', { roomId: 'nope' }), 'bad_room');
  err(await host.ws.emit('room:join', { roomId: 'abcdefgh' }), 'no_room');
  err(await host.ws.emit('seat:claim', 'garbage'), 'bad_request');
  err(await host.ws.emit('room:settings', {}), 'bad_settings');
  err(await host.ws.emit('turn:play', { steps: [[1, 2]] }), 'no_game');
  err(await host.ws.emit('game:resign', {}), 'no_game');

  ok(await host.ws.emit('room:settings', { name: 'Renamed', timeMinutes: 7, incrementSec: 0, visibility: 'private' }));
  const renamed = await host.ws.waitState((x) => x.room.name === 'Renamed');
  assert.deepEqual([renamed.room.timeMinutes, renamed.room.incrementSec, renamed.room.visibility], [7, 0, 'private']);
});

test('only the seat on turn can play, and every illegal turn is refused without side effects', async (t) => {
  const { baseUrl } = await withServer(t, { seed: 5 });
  const a = await human(baseUrl, 'player_a');
  const b = await human(baseUrl, 'player_b');
  const spectator = await human(baseUrl);
  const { roomId } = await a.ws.emit('room:create', {});
  await b.ws.emit('room:join', { roomId });
  await spectator.ws.emit('room:join', { roomId });
  ok(await a.ws.emit('seat:claim', { seat: 't1' }));
  ok(await b.ws.emit('seat:claim', { seat: 'b1' }));
  ok(await a.ws.emit('bot:set', { seat: 't2', level: 1 }));
  ok(await a.ws.emit('bot:set', { seat: 'b2', level: 1 }));
  autoPlay(b.ws, 'b1', 11);
  ok(await a.ws.emit('seat:ready', { ready: true }));
  ok(await b.ws.emit('seat:ready', { ready: true }));

  const turn = await a.ws.waitState((s) => s.phase === 'playing' && s.game.actor === 't1' && s.game.dice !== null && !s.game.result);
  const rng = createRng(2);
  const good = chooseTurnFromState(turn, rng);

  err(await b.ws.emit('turn:play', { steps: good }), 'not_your_turn');
  err(await spectator.ws.emit('turn:play', { steps: good }), 'no_seat');
  err(await a.ws.emit('turn:play', { steps: [] }), 'bad_steps');
  err(await a.ws.emit('turn:play', { steps: [[1, 2, 3]] }), 'bad_steps');
  err(await a.ws.emit('turn:play', { steps: 'nope' }), 'bad_steps');
  err(await a.ws.emit('turn:play', {}), 'bad_steps');
  const unrolled = [1, 2, 3, 4, 5, 6].find((d) => !turn.game.dice.includes(d));
  err(await a.ws.emit('turn:play', { steps: [[24, unrolled]] }), 'illegal_turn');
  err(await a.ws.emit('turn:play', { steps: [[13, turn.game.dice[0]]] }), 'illegal_turn');
  if (good.length > 1) err(await a.ws.emit('turn:play', { steps: good.slice(0, 1) }), 'illegal_turn');
  assert.equal(a.ws.state.game.position, turn.game.position, 'refused turns change nothing');
  assert.equal(a.ws.state.game.turnNumber, turn.game.turnNumber);

  ok(await a.ws.emit('turn:play', { steps: good }));
  const after = await a.ws.waitState((s) => s.game.turnNumber > turn.game.turnNumber);
  assert.notEqual(after.game.position, turn.game.position);
  assert.equal(after.game.last.actor, 't1');
  assert.deepEqual(after.game.last.steps.map(([f, d]) => [f, d]), good);
  assert.ok(after.game.last.steps.every((st) => st.length === 3 && st[2] >= 0 && st[2] <= 24));
  err(await a.ws.emit('turn:play', { steps: good }), 'not_your_turn');
});

test('a human who does not move loses on time, bots never burn the clock', async (t) => {
  const { p } = await soloGame(t, { clockUnits: { minuteMs: 60, secondMs: 1 } }, { timeMinutes: 1, incrementSec: 0 });
  assert.equal(p.ws.state.room.timeMinutes, 1);
  ok(await p.ws.emit('seat:ready', { ready: true }));
  const over = await p.ws.waitState((s) => s.phase === 'over', 10000);
  assert.deepEqual(over.game.result, { winnerTeam: 1, reason: 'timeout' }, 'Top (the human team) flags, Bottom wins');
  assert.equal(over.game.clocks.running, null);
  assert.equal(over.game.clocks.pools[0], 0);
  assert.equal(over.game.clocks.pools[1], 60, 'the bots team lost no time');
});

test('increments are added after every human turn', async (t) => {
  const { p } = await soloGame(t, { clockUnits: { minuteMs: 60000, secondMs: 1000 } }, { timeMinutes: 1, incrementSec: 3 });
  autoPlay(p.ws, 't1');
  ok(await p.ws.emit('seat:ready', { ready: true }));
  const played = await p.ws.waitState((s) => s.game && s.game.last?.actor === 't1' && !s.game.last.passed);
  assert.ok(played.game.clocks.pools[0] > 60000, `pool ${played.game.clocks.pools[0]} includes the increment`);
  assert.ok(played.game.clocks.pools[0] <= 63000);
  assert.equal(played.game.clocks.pools[1], 60000);
  await p.ws.emit('game:resign', {});
});

test('resigning ends the game for the whole team, and a rematch returns to the lobby', async (t) => {
  const { p, server } = await soloGame(t);
  ok(await p.ws.emit('seat:ready', { ready: true }));
  const playing = await p.ws.waitState((s) => s.phase === 'playing');
  const firstGame = playing.game.gameId;
  err(await p.ws.emit('room:leave', {}), 'in_game');
  err(await p.ws.emit('game:rematch', {}), 'no_game');
  err(await p.ws.emit('seat:release', { seat: 't1' }), 'not_lobby');
  err(await p.ws.emit('bot:set', { seat: 'b1', level: null }), 'not_lobby');

  ok(await p.ws.emit('game:resign', {}));
  const over = await p.ws.waitState((s) => s.phase === 'over');
  assert.deepEqual(over.game.result, { winnerTeam: 1, reason: 'resign' });
  err(await p.ws.emit('game:resign', {}), 'no_game');
  assert.equal(server.store.getGame(firstGame).reason, 'resign');

  ok(await p.ws.emit('game:rematch', {}));
  const lobby = await p.ws.waitState((s) => s.phase === 'lobby');
  assert.equal(lobby.game, null);
  assert.equal(lobby.seats.t1.ready, false);
  assert.equal(lobby.seats.b1.kind, 'bot', 'bots stay seated');
  ok(await p.ws.emit('seat:ready', { ready: true }));
  const second = await p.ws.waitState((s) => s.phase === 'playing');
  assert.notEqual(second.game.gameId, firstGame);
  err(await p.ws.emit('room:settings', { timeMinutes: 5 }), 'not_lobby');
  await p.ws.emit('game:resign', {});
});

test('a player who reconnects gets the seat and the running game back', async (t) => {
  const { baseUrl, server } = await withServer(t, { seed: 9 });
  const p = await human(baseUrl, 'returner');
  const observer = await human(baseUrl);
  const { roomId } = await p.ws.emit('room:create', {});
  await observer.ws.emit('room:join', { roomId });
  await p.ws.emit('seat:claim', { seat: 't1' });
  await p.ws.emit('bot:fill', { level: 1 });
  await p.ws.emit('seat:ready', { ready: true });
  const turn = await p.ws.waitState((s) => s.phase === 'playing' && s.game.actor === 't1' && s.game.dice !== null);

  p.ws.close();
  const away = await observer.ws.waitState((s) => s.seats.t1 && s.seats.t1.connected === false);
  assert.equal(away.phase, 'playing', 'the game goes on without them');
  assert.equal(away.seats.t1.name, 'returner');

  const back = await new TestSocket(baseUrl, p.http.cookie).ready();
  const state = await back.waitState((s) => s.you?.seat === 't1');
  assert.equal(state.room.id, roomId);
  assert.equal(state.game.turnNumber, turn.game.turnNumber);
  assert.equal(state.game.position, turn.game.position);
  await observer.ws.waitState((s) => s.seats.t1.connected === true);

  autoPlay(back, 't1');
  ok(await back.emit('game:resign', {}));
  assert.equal(server.rooms.get(roomId).phase, 'over');
});

test('team chat reaches only the team, all-chat reaches everyone, and spam is limited', async (t) => {
  const { baseUrl } = await withServer(t);
  const a = await human(baseUrl, 'chat_a');
  const b = await human(baseUrl, 'chat_b');
  const c = await human(baseUrl, 'chat_c');
  const watcher = await human(baseUrl);
  const { roomId } = await a.ws.emit('room:create', {});
  for (const x of [b, c, watcher]) await x.ws.emit('room:join', { roomId });
  await a.ws.emit('seat:claim', { seat: 't1' });
  await b.ws.emit('seat:claim', { seat: 't2' });
  await c.ws.emit('seat:claim', { seat: 'b1' });

  ok(await a.ws.emit('chat:send', { text: '  secret   plan  ', channel: 'team' }));
  ok(await c.ws.emit('chat:send', { text: 'hello all', channel: 'all' }));
  ok(await watcher.ws.emit('chat:send', { text: 'nice game', channel: 'all' }));
  err(await watcher.ws.emit('chat:send', { text: 'psst', channel: 'team' }), 'no_seat');
  err(await a.ws.emit('chat:send', { text: '', channel: 'all' }), 'bad_text');
  err(await a.ws.emit('chat:send', { text: 'x'.repeat(301), channel: 'all' }), 'bad_text');
  err(await a.ws.emit('chat:send', { text: 'hi', channel: 'secret' }), 'bad_channel');
  await new Promise((r) => setTimeout(r, 150));

  const texts = (x) => x.chat.map((m) => m.text);
  assert.deepEqual(texts(a.ws), ['secret plan', 'hello all', 'nice game']);
  assert.deepEqual(texts(b.ws), ['secret plan', 'hello all', 'nice game'], 'the teammate sees the team message');
  assert.deepEqual(texts(c.ws), ['hello all', 'nice game'], 'opponents do not');
  assert.deepEqual(texts(watcher.ws), ['hello all', 'nice game'], 'spectators do not');
  assert.deepEqual(a.ws.chat[0].from, { name: 'chat_a', seat: 't1' });
  assert.equal(a.ws.chat[0].channel, 'team');

  const late = await human(baseUrl);
  await late.ws.emit('room:join', { roomId });
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(late.ws.history.map((m) => m.text), ['hello all', 'nice game'], 'history only contains what the user may see');

  const results = [];
  for (let i = 0; i < 12; i++) results.push((await a.ws.emit('chat:send', { text: `spam ${i}`, channel: 'all' })).error ?? 'ok');
  assert.ok(results.includes('rate_limited'), results.join(','));
});

test('a teammate can suggest a legal turn that only the team sees', async (t) => {
  const { baseUrl } = await withServer(t, { seed: 21 });
  const t1 = await human(baseUrl, 'tt_one');
  const t2 = await human(baseUrl, 'tt_two');
  const b1 = await human(baseUrl, 'bb_one');
  const { roomId } = await t1.ws.emit('room:create', {});
  await t2.ws.emit('room:join', { roomId });
  await b1.ws.emit('room:join', { roomId });
  const spectator = await human(baseUrl);
  await spectator.ws.emit('room:join', { roomId });
  await t1.ws.emit('seat:claim', { seat: 't1' });
  await t2.ws.emit('seat:claim', { seat: 't2' });
  await b1.ws.emit('seat:claim', { seat: 'b1' });
  await t1.ws.emit('bot:set', { seat: 'b2', level: 1 });
  autoPlay(t2.ws, 't2', 3);
  autoPlay(b1.ws, 'b1', 4);
  await t1.ws.emit('seat:ready', { ready: true });
  await t2.ws.emit('seat:ready', { ready: true });
  await b1.ws.emit('seat:ready', { ready: true });

  const turn = await t2.ws.waitState((s) => s.phase === 'playing' && s.game.actor === 't1' && s.game.dice !== null && !s.game.result);
  const rng = createRng(8);
  const idea = chooseTurnFromState(turn, rng);

  err(await t1.ws.emit('suggest:set', { steps: idea }), 'not_your_turn');
  err(await b1.ws.emit('suggest:set', { steps: idea }), 'not_your_turn');
  err(await spectator.ws.emit('suggest:set', { steps: idea }), 'no_seat');
  err(await t2.ws.emit('suggest:set', { steps: [[24, 7]] }), 'bad_steps');
  const unrolled = [1, 2, 3, 4, 5, 6].find((d) => !turn.game.dice.includes(d));
  err(await t2.ws.emit('suggest:set', { steps: [[24, unrolled]] }), 'illegal_turn');
  ok(await t2.ws.emit('suggest:set', { steps: idea }));

  const mine = await t1.ws.waitState((s) => s.you.suggestions.length === 1);
  assert.deepEqual(mine.you.suggestions[0], { seat: 't2', steps: idea, turnNumber: turn.game.turnNumber });
  await t2.ws.waitState((s) => s.you.suggestions.length === 1);
  const opponent = await b1.ws.waitState((s) => s.version >= mine.version);
  assert.deepEqual(opponent.you.suggestions, [], 'the opposing team sees nothing');

  ok(await t2.ws.emit('suggest:clear', {}));
  await t1.ws.waitState((s) => s.you.suggestions.length === 0);
  ok(await t2.ws.emit('suggest:set', { steps: idea }));
  await t1.ws.waitState((s) => s.you.suggestions.length === 1);
  ok(await t1.ws.emit('turn:play', { steps: idea }));
  const next = await t1.ws.waitState((s) => s.game.turnNumber > turn.game.turnNumber);
  assert.deepEqual(next.you.suggestions, [], 'a suggestion expires with the turn');
});

test('public rooms are listed, private ones are not, and creating rooms is limited per user', async (t) => {
  const { baseUrl } = await withServer(t, { limits: { roomsPerUser: 2 } });
  const a = await human(baseUrl, 'lister');
  const view = new HttpClient(baseUrl);
  await view.guest();
  const open = await a.ws.emit('room:create', { name: 'Open table', visibility: 'public' });
  ok(open);
  await a.ws.emit('seat:claim', { seat: 't1' });

  const second = await new TestSocket(baseUrl, a.http.cookie).ready();
  const hidden = await second.emit('room:create', { name: 'Hidden', visibility: 'private' });
  ok(hidden);
  const third = await new TestSocket(baseUrl, a.http.cookie).ready();
  err(await third.emit('room:create', {}), 'too_many_rooms');

  const list = (await view.get('/api/rooms')).json.rooms;
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], { id: open.roomId, name: 'Open table', host: 'lister', humans: 1, bots: 0, phase: 'lobby', timeMinutes: 15, incrementSec: 5 });
  const joined = await new TestSocket(baseUrl, view.cookie).ready();
  ok(await joined.emit('room:join', { roomId: hidden.roomId }), 'a private room can be joined with its id');
});

test('logging out closes the sockets of that user', async (t) => {
  const { baseUrl } = await withServer(t);
  const p = await human(baseUrl);
  const closed = new Promise((resolve) => p.ws.socket.on('disconnect', resolve));
  await p.http.post('/api/logout');
  assert.equal(await closed, 'io server disconnect');
});

test('socket events are rate limited per connection', async (t) => {
  const { baseUrl } = await withServer(t);
  const p = await human(baseUrl);
  const { roomId } = await p.ws.emit('room:create', {});
  assert.ok(roomId);
  const answers = await Promise.all(Array.from({ length: 80 }, () => p.ws.emit('seat:claim', { seat: 't1' })));
  assert.ok(answers.some((a) => a.error === 'rate_limited'));
  assert.ok(answers.some((a) => a.ok === true));
});

test('empty lobbies disappear and idle finished rooms are swept', async (t) => {
  const { baseUrl, server } = await withServer(t, { roomIdleMs: 50 });
  const p = await human(baseUrl);
  const { roomId } = await p.ws.emit('room:create', {});
  assert.ok(server.rooms.get(roomId));
  await p.ws.emit('room:leave', {});
  assert.equal(server.rooms.get(roomId), null, 'an empty lobby is removed at once');

  const q = await human(baseUrl);
  const room = await q.ws.emit('room:create', {});
  await q.ws.emit('seat:claim', { seat: 't1' });
  await q.ws.emit('bot:fill', { level: 1 });
  await q.ws.emit('seat:ready', { ready: true });
  await q.ws.waitState((s) => s.phase === 'playing');
  await q.ws.emit('game:resign', {});
  await q.ws.waitState((s) => s.phase === 'over');
  q.ws.close();
  await new Promise((r) => setTimeout(r, 120));
  server.rooms.sweep();
  assert.equal(server.rooms.get(room.roomId), null, 'a finished room with nobody in it is swept');
});

test('leaving a finished game frees the seat and is not followed by an automatic rejoin', async (t) => {
  const { p, baseUrl, server, roomId } = await soloGame(t);
  ok(await p.ws.emit('seat:ready', { ready: true }));
  await p.ws.waitState((s) => s.phase === 'playing');
  ok(await p.ws.emit('game:resign', {}));
  await p.ws.waitState((s) => s.phase === 'over');
  ok(await p.ws.emit('room:leave', {}), 'leaving after the game is allowed');
  const room = server.rooms.get(roomId);
  assert.equal(room.members.size, 0, 'the finished room stays until it is swept');
  assert.equal(room.seatOf('u:1'), null, 'the seat was freed');
  assert.equal(server.rooms.roomOfUser('u:1'), null);

  const again = await new TestSocket(baseUrl, p.http.cookie).ready();
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(again.state, null, 'nothing to rejoin');
});

test('a running game in a room that disappears is recorded as abandoned', async (t) => {
  const { p, server, roomId } = await soloGame(t, { timing: { startDelayMs: 0, rollDelayMs: 0, passDelayMs: 0, botThinkMs: 0 } });
  ok(await p.ws.emit('seat:ready', { ready: true }));
  const playing = await p.ws.waitState((s) => s.phase === 'playing');
  server.rooms.remove(roomId);
  const row = server.store.getGame(playing.game.gameId);
  assert.equal(row.reason, 'abandoned');
  assert.equal(row.winnerTeam, -1);
});
