import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Position,
  applyTurn,
  diceList,
  enumerateTurns,
  legalNextSteps,
  normalizeSteps,
  stepsToWire,
  turnLimits,
  validateTurn,
} from '../engine/index.js';
import { B1, T1, pos, rules } from '../testkit/helpers.js';

const outcomes = (p, s, turns) => turns.map((t) => {
  const c = p.clone();
  applyTurn(c, s, t.steps);
  return c.toText();
}).sort();
const wire = (steps) => steps.map((st) => [st.from, st.die]);

test('dice list expands doubles to four moves', () => {
  assert.deepEqual(diceList([3, 5]), [3, 5]);
  assert.deepEqual(diceList([4, 4]), [4, 4, 4, 4]);
});

test('opening 6-1 for t1 has two distinct outcomes', () => {
  const p = Position.initial(rules);
  const turns = enumerateTurns(p, T1, [6, 1]);
  const expected = [
    pos({ 1: 'b1:8', 7: 'b2:8', 18: 't1:1+t2:8', 23: 't1:1', 24: 't1:6' }),
    pos({ 1: 'b1:8', 7: 'b2:8', 17: 't1:1', 18: 't2:8', 24: 't1:7' }),
  ].map((x) => x.toText()).sort();
  assert.deepEqual(outcomes(p, T1, turns), expected);
  assert.ok(turns.every((t) => t.steps.length === 2));
});

test('enumerateTurns does not mutate its input and can return resulting positions', () => {
  const p = Position.initial(rules);
  const before = p.toText();
  const turns = enumerateTurns(p, T1, [5, 3], { withPositions: true });
  assert.equal(p.toText(), before);
  for (const t of turns) {
    const check = p.clone();
    applyTurn(check, T1, t.steps);
    assert.ok(check.sameAs(t.after));
    assert.equal(t.key, check.key());
  }
});

test('when only one die can be played the larger one is forced', () => {
  const p = pos({ 8: 't1:1', 1: 'b1:2' });
  const limits = turnLimits(p, T1, [3, 4]);
  assert.deepEqual(limits, { target: 1, forcedDie: 4 });
  assert.deepEqual(enumerateTurns(p, T1, [3, 4]).map((t) => wire(t.steps)), [[[8, 4]]]);
  assert.deepEqual(wire(legalNextSteps(p, T1, [3, 4], 0, limits)), [[8, 4]]);
});

test('the smaller die is used when the larger cannot be played', () => {
  const p = pos({ 8: 't1:1', 4: 'b1:2', 1: 'b2:2' });
  const limits = turnLimits(p, T1, [3, 4]);
  assert.deepEqual(limits, { target: 1, forcedDie: 3 });
  assert.deepEqual(enumerateTurns(p, T1, [4, 3]).map((t) => wire(t.steps)), [[[8, 3]]]);
});

test('both dice must be played whenever some order allows it', () => {
  const p = pos({ 8: 't1:1' });
  assert.deepEqual(turnLimits(p, T1, [3, 4]), { target: 2, forcedDie: null });
  const turns = enumerateTurns(p, T1, [3, 4]);
  assert.equal(turns.length, 1, 'both orders reach the same position');
  assert.equal(turns[0].steps.length, 2);

  // 4 first lands on a blocked point, so only the 3-then-4 order can play both dice.
  const q = pos({ 8: 't1:1', 4: 'b1:2' });
  assert.deepEqual(turnLimits(q, T1, [3, 4]), { target: 2, forcedDie: null });
  assert.deepEqual(enumerateTurns(q, T1, [3, 4]).map((t) => wire(t.steps)), [[[8, 3], [5, 4]]]);
  assert.deepEqual(wire(legalNextSteps(q, T1, [3, 4], 0, turnLimits(q, T1, [3, 4]))), [[8, 3]]);
});

test('a position with no legal step is a single empty turn', () => {
  const p = pos({ 6: 't1:1!+b1:1' });
  assert.deepEqual(turnLimits(p, T1, [3, 4]), { target: 0, forcedDie: null });
  const turns = enumerateTurns(p, T1, [3, 4]);
  assert.equal(turns.length, 1);
  assert.deepEqual(turns[0].steps, []);
  assert.deepEqual(legalNextSteps(p, T1, [3, 4], 0, { target: 0, forcedDie: null }), []);
});

test('doubles play four moves and collapse equivalent orders', () => {
  const p = pos({ 10: 't1:2' });
  const limits = turnLimits(p, T1, [2, 2]);
  assert.deepEqual(limits, { target: 4, forcedDie: null });
  const turns = enumerateTurns(p, T1, [2, 2]);
  assert.deepEqual(outcomes(p, T1, turns), [
    pos({ 2: 't1:1', 10: 't1:1' }),
    pos({ 4: 't1:1', 8: 't1:1' }),
    pos({ 6: 't1:2' }),
  ].map((x) => x.toText()).sort());

  assert.deepEqual(wire(legalNextSteps(p, T1, [2, 2, 2, 2], 0, limits)), [[10, 2]]);
  p.applyStep(T1, 10, 2);
  assert.deepEqual(wire(legalNextSteps(p, T1, [2, 2, 2], 1, limits)), [[10, 2], [8, 2]]);
});

test('doubles that cannot move are a pass', () => {
  const p = pos({ 12: 't1:1', 6: 'b1:2' });
  assert.equal(turnLimits(p, T1, [6, 6]).target, 0);
});

test('a die used to bear off counts as played', () => {
  const p = pos({ 8: 't1:1' });
  const turns = enumerateTurns(p, T1, [6, 5]);
  assert.deepEqual(outcomes(p, T1, turns), [pos({}, { t1: 1 }).toText()]);
  assert.deepEqual(turns[0].steps.map((st) => st.to), [2, 0]);
});

test('validateTurn accepts legal turns in any order and rejects everything else', () => {
  const p = Position.initial(rules);
  const ok = (steps) => validateTurn(p, T1, [6, 1], normalizeSteps(steps));
  assert.ok(ok([[24, 6], [24, 1]]).ok);
  assert.ok(ok([[24, 1], [24, 6]]).ok);
  assert.ok(ok([[24, 6], [18, 1]]).ok);
  assert.ok(!ok([[24, 6], [24, 6]]).ok, 'die 6 twice');
  assert.ok(!ok([[24, 6]]).ok, 'second die must be played');
  assert.ok(!ok([[24, 6], [24, 1], [24, 1]]).ok, 'too many steps');
  assert.ok(!ok([[23, 6], [24, 1]]).ok, 'no checker on 23');
  assert.ok(!ok([]).ok);
  const result = ok([[24, 6], [24, 1]]);
  assert.equal(result.after.pipsLeft(T1), 192 - 7);
  assert.equal(p.pipsLeft(T1), 192, 'validation works on a copy');
});

test('step helpers normalise wire formats', () => {
  assert.deepEqual(normalizeSteps([[24, 6], { from: 18, die: 1 }]), [{ from: 24, die: 6 }, { from: 18, die: 1 }]);
  assert.deepEqual(stepsToWire([{ from: 24, die: 6, to: 18 }]), [[24, 6]]);
  assert.throws(() => normalizeSteps('x'), TypeError);
  assert.throws(() => normalizeSteps([[24]]), TypeError);
  assert.throws(() => normalizeSteps([{ from: '24', die: 1 }]), TypeError);
});

test('bottom team turns mirror top team turns', () => {
  const top = Position.initial(rules);
  const bottom = Position.initial(rules);
  for (const dice of [[6, 1], [3, 3], [5, 2], [6, 6]]) {
    const a = enumerateTurns(top, T1, dice).length;
    const b = enumerateTurns(bottom, B1, dice).length;
    assert.equal(a, b, `dice ${dice}`);
  }
});
