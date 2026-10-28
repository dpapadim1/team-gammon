import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Game,
  Position,
  QUADRANT_PLAKOTO_4P,
  compileVariant,
  createRng,
  enumerateTurns,
  reverseCycle,
  withCheckersPerSeat,
} from '../engine/index.js';
import { B1, B2, T1, T2, rules } from '../testkit/helpers.js';

test('seat tables follow the spec', () => {
  assert.deepEqual(rules.seatIds, ['t1', 'b1', 't2', 'b2']);
  assert.deepEqual(Array.from(rules.startPoint), [24, 1, 18, 7]);
  assert.equal(rules.dist[T1][24], 24);
  assert.equal(rules.dist[T1][1], 1);
  assert.equal(rules.dist[B1][1], 24);
  assert.equal(rules.dist[B1][24], 1);
  assert.equal(rules.dist[T2][18], 18);
  assert.equal(rules.dist[B2][7], 18);
  assert.equal(rules.pointAt[B1][24], 1);
  assert.equal(rules.pointAt[B1][1], 24);
  assert.equal(rules.pointAt[T1][5], 5);
  assert.deepEqual(rules.teamSeats.map((s) => [...s]), [[T1, T2], [B1, B2]]);
  assert.deepEqual(rules.mates.map((m) => [...m]), [[T2], [B2], [T1], [B1]]);
});

test('initial position: stacks on start points, equal team pips', () => {
  const p = Position.initial(rules);
  assert.equal(p.countAt(24, T1), 8);
  assert.equal(p.countAt(1, B1), 8);
  assert.equal(p.countAt(18, T2), 8);
  assert.equal(p.countAt(7, B2), 8);
  assert.deepEqual([T1, B1, T2, B2].map((s) => p.pipsLeft(s)), [192, 192, 144, 144]);
  assert.equal(p.pipsLeft(T1) + p.pipsLeft(T2), 336);
  assert.equal(p.pipsLeft(B1) + p.pipsLeft(B2), 336);
  assert.deepEqual(p.checkInvariants(), []);
  const points = ['b1:8', ...Array(5).fill('.'), 'b2:8', ...Array(10).fill('.'), 't2:8', ...Array(5).fill('.'), 't1:8'];
  assert.equal(p.toText(), `${points.join('/')} 0,0,0,0`);
});

test('the board is 180 degree symmetric between the teams', () => {
  const v = QUADRANT_PLAKOTO_4P;
  for (const [a, b] of [[0, 1], [2, 3]]) {
    assert.equal(v.seats[a].start, v.numPoints + 1 - v.seats[b].start);
    assert.equal(v.seats[a].dir, -v.seats[b].dir);
  }
});

test('invalid variants are rejected', () => {
  const bad = (patch, pattern) => assert.throws(() => compileVariant({ ...QUADRANT_PLAKOTO_4P, ...patch }), pattern);
  bad({ numPoints: 1 }, /numPoints/);
  bad({ homeSize: 0 }, /homeSize/);
  bad({ checkersPerSeat: 0 }, /checkersPerSeat/);
  bad({ teams: [{ id: 'x' }] }, /two teams/);
  bad({ turnOrder: [0, 1, 2, 2] }, /turnOrder/);
  bad({ seats: QUADRANT_PLAKOTO_4P.seats.map((s, i) => (i === 1 ? { ...s, id: 't1' } : s)) }, /duplicate/);
  bad({ seats: QUADRANT_PLAKOTO_4P.seats.map((s, i) => (i === 1 ? { ...s, start: 24 } : s)) }, /share a start/);
  bad({ seats: QUADRANT_PLAKOTO_4P.seats.map((s, i) => (i === 0 ? { ...s, dir: 2 } : s)) }, /dir/);
  bad({ seats: QUADRANT_PLAKOTO_4P.seats.map((s, i) => (i === 0 ? { ...s, id: 'a:b' } : s)) }, /seat id/);
});

test('withCheckersPerSeat compiles to an independent rule set', () => {
  const small = compileVariant(withCheckersPerSeat(QUADRANT_PLAKOTO_4P, 3));
  assert.equal(small.checkersPerSeat, 3);
  assert.notEqual(small, rules);
  assert.equal(Position.initial(small).countAt(24, T1), 3);
});

test('reverseCycle walks the turn cycle the other way and is memoised', () => {
  const rev = reverseCycle(QUADRANT_PLAKOTO_4P);
  assert.deepEqual([...rev.turnOrder], [0, 3, 2, 1]);
  assert.equal(reverseCycle(QUADRANT_PLAKOTO_4P), rev);
  assert.equal(reverseCycle(rev), QUADRANT_PLAKOTO_4P);
  const compiled = compileVariant(rev);
  assert.deepEqual([...compiled.mates[T1]], [T2]);
  assert.equal(compiled.startSanctuary, true);

  const game = new Game(rev, { firstSlot: 0 });
  const order = [];
  const rng = createRng(4);
  for (let i = 0; i < 4; i++) {
    order.push(game.actor);
    game.roll(rng.roll());
    game.playTurn(enumerateTurns(game.position, game.actor, game.dice, { limits: game.limits })[0].steps);
  }
  assert.deepEqual(order, [T1, B2, T2, B1]);
});

test('the main rules include the start-point sanctuary', () => {
  assert.equal(QUADRANT_PLAKOTO_4P.startSanctuary, true);
  assert.equal(rules.startSanctuary, true);
});
