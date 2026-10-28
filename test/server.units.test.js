import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng, enumerateTurns, Game } from '../engine/index.js';
import { createBotForLevel, BOT_LEVELS } from '../bots/levels.js';
import { TeamClock } from '../server/clock.js';
import { buildConfig } from '../server/config.js';
import { openStore } from '../server/db.js';
import { hashPassword, verifyPassword } from '../server/passwords.js';
import { TokenBucket } from '../server/ratelimit.js';
import { ProtocolError } from '../server/errors.js';
import * as V from '../server/validate.js';
import { rules } from '../testkit/helpers.js';

const code = (fn) => {
  try {
    fn();
  } catch (err) {
    return err instanceof ProtocolError ? err.code : `unexpected: ${err}`;
  }
  return 'no error';
};

test('team clock charges only the running team and adds increments', () => {
  let t = 1000;
  const clock = new TeamClock({ poolMs: 10000, incrementMs: 2000, now: () => t });
  assert.deepEqual(clock.snapshot().pools, [10000, 10000]);
  clock.start(0);
  t += 3000;
  assert.equal(clock.remaining(0), 7000);
  assert.equal(clock.remaining(1), 10000);
  assert.equal(clock.snapshot().running, 0);
  clock.stop();
  clock.addIncrement(0);
  assert.deepEqual(clock.snapshot().pools, [9000, 10000]);
  t += 5000;
  assert.equal(clock.remaining(0), 9000, 'a stopped clock does not run');
  clock.start(1);
  t += 99999;
  assert.equal(clock.remaining(1), 0, 'never negative');
  clock.start(0);
  assert.equal(clock.pools[1], 0, 'switching teams stops the other one');
});

test('token bucket allows bursts and refills over time', () => {
  let t = 0;
  const bucket = new TokenBucket({ capacity: 3, refillPerSec: 1, now: () => t });
  assert.deepEqual([bucket.take(), bucket.take(), bucket.take(), bucket.take()], [true, true, true, false]);
  t += 1000;
  assert.equal(bucket.take(), true);
  assert.equal(bucket.take(), false);
  t += 60000;
  assert.deepEqual([bucket.take(), bucket.take(), bucket.take(), bucket.take()], [true, true, true, false], 'capped at capacity');
});

test('passwords hash with a salt and verify only the right one', async () => {
  const cost = { N: 1024, r: 8, p: 1 };
  const a = await hashPassword('correct horse', cost);
  const b = await hashPassword('correct horse', cost);
  assert.notEqual(a, b, 'random salt');
  assert.ok(a.startsWith('scrypt$1024$8$1$'));
  assert.equal(await verifyPassword('correct horse', a), true);
  assert.equal(await verifyPassword('correct horsf', a), false);
  assert.equal(await verifyPassword('correct horse', 'garbage'), false);
  assert.equal(await verifyPassword('correct horse', 'scrypt$x$8$1$AAAA$AAAA'), false);
  assert.equal(await verifyPassword('é', await hashPassword('é', cost)), true);
});

test('configuration requires a real secret in production and merges overrides', () => {
  assert.throws(() => buildConfig({ NODE_ENV: 'production' }), /SESSION_SECRET/);
  assert.throws(() => buildConfig({ NODE_ENV: 'production', SESSION_SECRET: 'short' }), /SESSION_SECRET/);
  const prod = buildConfig({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(32), PORT: '8080', TRUST_PROXY: '1', ALLOWED_ORIGINS: 'https://a.example, https://b.example' });
  assert.equal(prod.production, true);
  assert.equal(prod.secureCookies, true);
  assert.equal(prod.port, 8080);
  assert.equal(prod.trustProxy, 1);
  assert.deepEqual(prod.allowedOrigins, ['https://a.example', 'https://b.example']);
  const dev = buildConfig({}, { timing: { botThinkMs: 5 }, game: { timeMinutes: 3 } });
  assert.equal(dev.timing.botThinkMs, 5);
  assert.equal(dev.timing.passDelayMs, 1600, 'unspecified timing fields keep their defaults');
  assert.equal(dev.game.timeMinutes, 3);
  assert.equal(dev.game.incrementSec, 5);
  assert.throws(() => buildConfig({ PORT: 'abc' }), /PORT/);
  assert.throws(() => { dev.port = 1; }, TypeError, 'the configuration is frozen');
});

test('validators accept good input and reject bad input with stable codes', () => {
  assert.equal(code(() => V.username('alice_01')), 'no error');
  for (const bad of ['ab', 'a'.repeat(21), 'bad name', 'guest123', 'Admin', 'bot_x', '', 5, null]) assert.equal(code(() => V.username(bad)), 'bad_username', String(bad));
  assert.equal(code(() => V.password('longenough')), 'no error');
  for (const bad of ['short', 'x'.repeat(129), 'nul\u0000byte12', 7, undefined]) assert.equal(code(() => V.password(bad)), 'bad_password');
  assert.equal(code(() => V.password('Alice_01!', 'alice_01!')), 'bad_password', 'not equal to the username');

  assert.equal(V.text('  hello \n\t world\u0007  ', { max: 20 }), 'hello world');
  assert.equal(code(() => V.text('   ', { max: 20 })), 'bad_text');
  assert.equal(code(() => V.text('x'.repeat(301), { max: 300 })), 'bad_text');
  assert.equal(code(() => V.text(42, { max: 300 })), 'bad_text');

  assert.equal(V.roomId('k3m9x2ab'), 'k3m9x2ab');
  for (const bad of ['', 'ABCDEFGH', 'k3m9x2a', 'k3m9x2abc', 'k3m9x2a!', 1]) assert.equal(code(() => V.roomId(bad)), 'bad_room');
  assert.equal(V.seat('t2', rules), 't2');
  for (const bad of ['x1', 'T1', 5, undefined]) assert.equal(code(() => V.seat(bad, rules)), 'bad_seat');
  assert.equal(code(() => V.channel('team')), 'no error');
  assert.equal(code(() => V.channel('everyone')), 'bad_channel');
  assert.equal(V.level(9), 9);
  for (const bad of [0, 10, 1.5, '3', null]) assert.equal(code(() => V.level(bad)), 'bad_level');
});

test('step validation allows at most four integer moves in range', () => {
  assert.deepEqual(V.steps([[24, 6], [18, 1]], rules), [{ from: 24, die: 6 }, { from: 18, die: 1 }]);
  for (const bad of [[], [[1, 2], [1, 2], [1, 2], [1, 2], [1, 2]], [[0, 1]], [[25, 1]], [[1, 7]], [[1]], [[1, 2, 3]], [['1', 2]], 'nope', null, [[1.5, 2]]]) {
    assert.equal(code(() => V.steps(bad, rules)), 'bad_steps', JSON.stringify(bad));
  }
});

test('room options are validated for creation and for later changes', () => {
  assert.deepEqual(V.roomOptions({}, { creating: true }), {});
  assert.deepEqual(V.roomOptions({ name: ' My  room ', visibility: 'private', timeMinutes: 20, incrementSec: 0 }, { creating: true }), { name: 'My room', visibility: 'private', timeMinutes: 20, incrementSec: 0 });
  assert.equal(code(() => V.roomOptions({}, { creating: false })), 'bad_settings', 'a settings change must change something');
  for (const bad of [{ visibility: 'secret' }, { timeMinutes: 0 }, { timeMinutes: 121 }, { incrementSec: -1 }, { name: '' }, { name: 'x'.repeat(41) }, [], null]) {
    assert.equal(code(() => V.roomOptions(bad, { creating: true })), 'bad_settings', JSON.stringify(bad));
  }
});

test('store: users are unique ignoring case, and deleting one scrubs personal data', () => {
  const store = openStore(':memory:');
  const id = store.createUser('Alice', 'hash');
  assert.throws(() => store.createUser('alice', 'hash2'), /UNIQUE/);
  assert.equal(store.getUserByName('ALICE').id, id);

  const gameId = store.startGame({ roomId: 'room1234', variant: 'v', cycle: ['t1', 'b1', 't2', 'b2'], firstSlot: 0, startedAt: 1, timeMinutes: 15, incrementSec: 5, seats: { t1: { kind: 'human', name: 'Alice' }, b1: { kind: 'bot', name: 'Bot' } } }, [{ userId: id, seat: 't1' }]);
  store.addChat({ roomId: 'room1234', gameId, ts: 5, principal: `u:${id}`, name: 'Alice', channel: 'all', text: 'hi' });
  assert.equal(store.gamesOfUser(id).length, 0, 'unfinished games are not listed');
  store.finishGame(gameId, { endedAt: 9, winnerTeam: 0, reason: 'bearoff', history: [{ slot: 0 }], finalPosition: 'x' });
  assert.equal(store.gamesOfUser(id).length, 1);
  assert.equal(store.getGame(gameId).history[0].slot, 0);
  assert.equal(store.seatOfPlayer(gameId, id), 't1');

  store.deleteUser(id);
  assert.equal(store.getUserByName('alice'), undefined);
  assert.equal(store.getGame(gameId).seats.t1.name, 'deleted');
  assert.equal(store.seatOfPlayer(gameId, id), null);
  assert.equal(store.db.prepare("SELECT name FROM chat_messages WHERE principal = 'deleted'").get().name, 'deleted');
  store.close();
});

test('store: unfinished games are marked abandoned and old chat is purged', () => {
  const store = openStore(':memory:');
  const gameId = store.startGame({ roomId: 'room1234', variant: 'v', cycle: [], firstSlot: 0, startedAt: 50, timeMinutes: 1, incrementSec: 0, seats: {} }, []);
  assert.equal(store.abandonUnfinished(), 1);
  assert.equal(store.getGame(gameId).reason, 'abandoned');
  store.addChat({ roomId: 'r', ts: 10, principal: 'g:1', name: 'x', channel: 'all', text: 'old' });
  store.addChat({ roomId: 'r', ts: 1000, principal: 'g:1', name: 'x', channel: 'all', text: 'new' });
  assert.equal(store.purgeChat(500), 1);
  store.close();
});

test('bot levels return legal turns for every level', () => {
  const rng = createRng(3);
  for (const level of Object.keys(BOT_LEVELS).map(Number)) {
    const bot = createBotForLevel(level, rng);
    const game = new Game();
    for (let i = 0; i < 6; i++) {
      game.roll(rng.roll());
      if (game.phase !== 'move') continue;
      const steps = bot.chooseTurn(game);
      const legal = enumerateTurns(game.position, game.actor, game.dice, { limits: game.limits });
      game.playTurn(steps);
      assert.ok(legal.length > 0, `level ${level}`);
    }
  }
  assert.throws(() => createBotForLevel(0, rng), RangeError);
  assert.throws(() => createBotForLevel(10, rng), RangeError);
});
