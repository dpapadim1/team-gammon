import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Game,
  IllegalMoveError,
  Position,
  QUADRANT_PLAKOTO_4P,
  compileVariant,
  createRng,
  enumerateTurns,
  isDeadlocked,
  winnerByPips,
  withCheckersPerSeat,
} from '../engine/index.js';
import { B1, B2, T1, T2, playRandom, pos, rules } from '../testkit/helpers.js';

const wire = (steps) => steps.map((st) => [st.from, st.die]);

test('seats play in the fixed order t1, b1, t2, b2', () => {
  const g = new Game();
  const rng = createRng(3);
  const actors = [];
  for (let i = 0; i < 8; i++) {
    actors.push(g.actor);
    g.roll(rng.roll());
    assert.equal(g.phase, 'move');
    const [turn] = enumerateTurns(g.position, g.actor, g.dice, { limits: g.limits });
    g.playTurn(turn.steps);
  }
  assert.deepEqual(actors, [T1, B1, T2, B2, T1, B1, T2, B2]);
});

test('a finished seat\'s roll is played by its teammate', () => {
  const p = pos({ 24: 't1:8', 1: 'b1:8', 7: 'b2:8' }, { t2: 8 });
  const g = new Game(QUADRANT_PLAKOTO_4P, { firstSlot: 2, position: p });
  assert.equal(g.slotSeat, T2);
  assert.equal(g.actor, T1);
  g.roll([6, 5]);
  const entry = g.playTurn([[24, 6], [24, 5]]);
  assert.deepEqual(entry, { slot: 2, actor: T1, dice: [6, 5], steps: [[24, 6], [24, 5]] });
  assert.equal(g.slotSeat, B2);
  assert.equal(g.actor, B2);
});

test('the game ends the moment a team\'s last checker is borne off', () => {
  const p = pos({ 2: 't1:1', 1: 'b1:8', 7: 'b2:8' }, { t1: 7, t2: 8 });
  const g = new Game(QUADRANT_PLAKOTO_4P, { firstSlot: 0, position: p });
  assert.equal(g.actor, T1);
  const rolled = g.roll([5, 6]);
  assert.deepEqual(rolled, { passed: false, target: 1, forcedDie: 6 });
  assert.throws(() => g.playTurn([[2, 5]]), IllegalMoveError, 'the larger die is forced');
  g.playTurn([[2, 6]]);
  assert.equal(g.over, true);
  assert.equal(g.phase, 'over');
  assert.deepEqual(g.result(), { winnerTeam: 0, reason: 'bearoff' });
  assert.equal(g.history.length, 1);
  assert.throws(() => g.roll([1, 2]), IllegalMoveError);
});

test('a game constructed with a finished team is already over', () => {
  const p = pos({ 1: 'b1:8', 7: 'b2:8' }, { t1: 8, t2: 8 });
  const g = new Game(QUADRANT_PLAKOTO_4P, { position: p });
  assert.deepEqual(g.result(), { winnerTeam: 0, reason: 'bearoff' });
});

test('a pass advances the turn and is recorded', () => {
  const p = pos({ 6: 't1:1!+b1:1', 7: 'b2:2', 18: 't2:2' }, { t1: 0 });
  const g = new Game(QUADRANT_PLAKOTO_4P, { firstSlot: 0, position: p });
  const rolled = g.roll([3, 4]);
  assert.equal(rolled.passed, true);
  assert.deepEqual(g.history[0].steps, []);
  assert.equal(g.actor, B1);
  assert.equal(g.phase, 'roll');
});

test('an empty board is a deadlock and is decided by pips', () => {
  assert.equal(isDeadlocked(Position.initial(rules)), false);
  const empty = pos({}, {});
  assert.equal(isDeadlocked(empty), true);
  const g = new Game(QUADRANT_PLAKOTO_4P, { position: empty });
  g.roll([3, 4]);
  assert.deepEqual(g.result(), { winnerTeam: -1, reason: 'deadlock' });
});

test('winnerByPips compares the two teams', () => {
  assert.equal(winnerByPips(pos({ 3: 't1:1', 20: 'b1:1' })), 0, '3 pips vs 5');
  assert.equal(winnerByPips(pos({ 6: 't1:1', 20: 'b1:1' })), 1, '6 pips vs 5');
  assert.equal(winnerByPips(pos({ 5: 't1:1', 20: 'b1:1' })), -1, '5 pips vs 5');
});

test('roll and move input is validated', () => {
  const g = new Game();
  assert.throws(() => g.playStep(24, 6), IllegalMoveError);
  assert.throws(() => g.playTurn([[24, 6]]), IllegalMoveError);
  for (const bad of [[0, 3], [7, 1], [1], [1.5, 2], 'ab', null]) assert.throws(() => g.roll(bad), IllegalMoveError);
  g.roll([6, 1]);
  assert.throws(() => g.roll([1, 2]), IllegalMoveError, 'already rolled');
  const before = g.position.toText();
  assert.throws(() => g.playTurn([[24, 6]]), IllegalMoveError, 'incomplete turn');
  assert.throws(() => g.playTurn([[24, 6], [24, 6]]), IllegalMoveError, 'wrong die');
  assert.throws(() => g.playTurn('nope'), TypeError);
  assert.equal(g.position.toText(), before, 'rejected turns leave the position untouched');
  assert.equal(g.phase, 'move');
  assert.throws(() => g.playStep(24, 5), IllegalMoveError, 'die not rolled');
});

test('steps can be played and undone one by one', () => {
  const g = new Game();
  const start = g.position.toText();
  g.roll([6, 1]);
  assert.deepEqual(wire(g.legalSteps()), [[24, 1], [24, 6]]);
  assert.equal(g.playStep(24, 6), null);
  assert.deepEqual(wire(g.legalSteps()), [[24, 1], [18, 1]]);
  g.undoStep();
  assert.equal(g.position.toText(), start);
  assert.throws(() => g.undoStep(), IllegalMoveError);

  g.playStep(24, 1);
  const entry = g.playStep(24, 6);
  assert.deepEqual(entry, { slot: 0, actor: T1, dice: [6, 1], steps: [[24, 1], [24, 6]] });
  assert.equal(g.actor, B1);
  assert.equal(g.history.length, 1);
  assert.throws(() => g.undoStep(), IllegalMoveError, 'a finished turn cannot be undone');
});

test('clone is independent of the original', () => {
  const g = new Game();
  g.roll([6, 1]);
  const c = g.clone();
  c.playStep(24, 6);
  assert.equal(g.steps.length, 0);
  assert.equal(c.steps.length, 1);
  assert.notEqual(g.position.toText(), c.position.toText());
  c.undoStep();
  assert.equal(c.position.toText(), g.position.toText());
});

test('a position from another variant is rejected', () => {
  const other = compileVariant(withCheckersPerSeat(QUADRANT_PLAKOTO_4P, 5));
  assert.throws(() => new Game(QUADRANT_PLAKOTO_4P, { position: Position.initial(other) }), /different variant/);
});

test('history replays to the identical final position', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const g = playRandom(seed);
    assert.ok(g.over, `seed ${seed} finishes`);
    const r = Game.replay(g.history);
    assert.ok(r.position.sameAs(g.position));
    assert.deepEqual(r.result(), g.result());
    assert.deepEqual(r.history, g.history);
  }
});

test('replay rejects tampered histories', () => {
  const g = playRandom(9);
  const withSteps = g.history.findIndex((e) => e.steps.length > 0);
  const tamper = (mutate) => {
    const copy = structuredClone(g.history);
    mutate(copy);
    return () => Game.replay(copy, { firstSlot: g.history[0].slot });
  };
  assert.throws(tamper((h) => { h[withSteps].steps[0][0] = 13; }), IllegalMoveError);
  assert.throws(tamper((h) => { h[withSteps].actor = (h[withSteps].actor + 1) % 4; }), IllegalMoveError);
  assert.throws(tamper((h) => { h[withSteps].steps.pop(); }), IllegalMoveError);
  assert.throws(tamper((h) => { h.push({ ...h[0] }); }), IllegalMoveError, 'history past the end');
});
