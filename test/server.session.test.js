import test from 'node:test';
import assert from 'node:assert/strict';
import { QUADRANT_PLAKOTO_4P, createRng, enumerateTurns } from '../engine/index.js';
import { createRandomBot } from '../bots/random.js';
import { GameSession } from '../server/gameSession.js';
import { ProtocolError } from '../server/errors.js';

const TIMING = { startDelayMs: 0, rollDelayMs: 0, passDelayMs: 0, botThinkMs: 0 };

function makeSession(overrides = {}) {
  const dice = createRng(4);
  const rng = createRng(5);
  const record = { changes: 0, result: null, overs: 0 };
  const session = new GameSession({
    variant: QUADRANT_PLAKOTO_4P,
    reversed: false,
    firstSlot: 0,
    controllers: Array.from({ length: 4 }, () => ({ kind: 'bot', bot: createRandomBot(rng) })),
    rollDice: () => dice.roll(),
    poolMs: 60000,
    incrementMs: 0,
    timing: TIMING,
    onChange: () => { record.changes++; },
    onOver: (s) => { record.result = s.result; record.overs++; },
    ...overrides,
  });
  return { session, record };
}

const finished = (record, ms = 8000) => new Promise((resolve, reject) => {
  const started = Date.now();
  const poll = setInterval(() => {
    if (record.overs > 0) {
      clearInterval(poll);
      resolve(record.result);
    } else if (Date.now() - started > ms) {
      clearInterval(poll);
      reject(new Error('game did not finish'));
    }
  }, 5);
});

test('an all-bot session plays to the end and reports one result', async () => {
  const { session, record } = makeSession();
  session.start();
  const result = await finished(record);
  assert.equal(result.reason, 'bearoff');
  assert.equal(record.overs, 1);
  assert.ok(record.changes > 50);
  assert.equal(session.clock.running, null, 'bots never run a clock');
  assert.deepEqual(session.clock.snapshot().pools, [60000, 60000]);
  assert.equal(session.snapshot().dice, null);
  assert.throws(() => session.resign(0), (e) => e instanceof ProtocolError && e.code === 'game_over');
  session.finish({ winnerTeam: 0, reason: 'resign' });
  assert.equal(record.overs, 1, 'finishing twice has no effect');
});

test('a bot that throws is replaced by a random legal turn', async (t) => {
  const quiet = t.mock.method(console, 'error', () => {});
  const broken = { chooseTurn() { throw new Error('boom'); } };
  const { session, record } = makeSession({ controllers: Array.from({ length: 4 }, () => ({ kind: 'bot', bot: broken })) });
  session.start();
  const result = await finished(record);
  assert.equal(result.reason, 'bearoff');
  assert.ok(quiet.mock.callCount() > 10);
});

test('an unexpected failure ends the game as a draw instead of crashing the process', async (t) => {
  const quiet = t.mock.method(console, 'error', () => {});
  let calls = 0;
  const { session, record } = makeSession({
    rollDice: () => {
      if (++calls === 5) throw new Error('dice failure');
      return [3, 4];
    },
  });
  session.start();
  const result = await finished(record);
  assert.deepEqual(result, { winnerTeam: -1, reason: 'error' });
  assert.equal(quiet.mock.callCount(), 1);
});

test('human seats play only on their own turn and the clock follows them', async () => {
  const humans = Array.from({ length: 4 }, () => ({ kind: 'human' }));
  const { session, record } = makeSession({ controllers: humans, poolMs: 500 });
  session.start();
  await new Promise((r) => setTimeout(r, 20));
  const g = session.game;
  assert.equal(g.phase, 'move');
  assert.equal(session.clock.running, session.rules.teamOf[g.actor]);
  const wrong = (g.actor + 1) % 4;
  assert.throws(() => session.playTurn(wrong, [{ from: 24, die: 1 }]), (e) => e.code === 'not_your_turn');
  const steps = enumerateTurns(g.position, g.actor, g.dice, { limits: g.limits })[0].steps;
  assert.throws(() => session.playTurn(g.actor, [{ from: 13, die: g.dice[0] }]), (e) => e.code === 'illegal_turn');
  session.playTurn(g.actor, steps);
  assert.equal(session.game.turnNumber, 1);
  session.stop();
  assert.equal(record.overs, 0);
});

test('a flagged human team loses and the clock is frozen', async () => {
  const humans = Array.from({ length: 4 }, () => ({ kind: 'human' }));
  const { session, record } = makeSession({ controllers: humans, poolMs: 30 });
  session.start();
  const result = await finished(record);
  const flagged = session.rules.teamOf[session.game.actor];
  assert.deepEqual(result, { winnerTeam: 1 - flagged, reason: 'timeout' });
  assert.equal(session.clock.running, null);
  assert.equal(session.clock.pools[flagged], 0);
  assert.throws(() => session.playTurn(session.game.actor, [{ from: 24, die: 1 }]), (e) => e.code === 'game_over');
});

test('the reversed cycle is reported in the snapshot', () => {
  const { session } = makeSession({ reversed: true });
  const snap = session.snapshot();
  assert.deepEqual(snap.cycle, ['t1', 'b2', 't2', 'b1']);
  assert.equal(snap.reversed, true);
  assert.equal(snap.actor, 't1');
});
