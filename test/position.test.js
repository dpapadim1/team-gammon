import test from 'node:test';
import assert from 'node:assert/strict';
import { BLOCKED, OFF, Position, QUADRANT_PLAIN_4P, compileVariant, createRng } from '../engine/index.js';
import { B1, B2, T1, T2, pos, posIn, rules } from '../testkit/helpers.js';

const pointText = (p, n) => p.toText().split(' ')[0].split('/')[n - 1];

test('a lone checker on its own start point cannot be pinned (sanctuary), but plain pinning allows it', () => {
  const plain = compileVariant(QUADRANT_PLAIN_4P);
  const at24 = { 24: 't1:1', 20: 'b1:1' };
  assert.equal(pos(at24).stepTarget(B1, 20, 4), BLOCKED, 't1 stands on its own start point');
  assert.equal(posIn(plain, at24).stepTarget(B1, 20, 4), 24, 'plain rules allow the pin');

  // Only the seat's own start point is a sanctuary: 18 is t2's start, not t1's.
  assert.equal(pos({ 18: 't1:1', 14: 'b1:1' }).stepTarget(B1, 14, 4), 18);
  assert.equal(pos({ 18: 't2:1', 14: 'b1:1' }).stepTarget(B1, 14, 4), BLOCKED);

  // The sanctuary protects a lone checker only; a pin that already exists is unaffected.
  const pinned = pos({ 24: 't1:1!+b1:1' });
  assert.equal(pinned.stepTarget(T1, 24, 1), BLOCKED, 'still pinned');
});

test('plain moves follow each seat direction', () => {
  const p = pos({ 10: 't1:2', 12: 'b1:1' });
  assert.equal(p.stepTarget(T1, 10, 3), 7);
  assert.equal(p.stepTarget(T1, 10, 6), 4);
  assert.equal(p.stepTarget(B1, 12, 3), 15);
  assert.equal(p.stepTarget(B1, 12, 6), 18);
  assert.equal(p.stepTarget(T1, 11, 1), BLOCKED, 'no checker there');
  assert.equal(p.stepTarget(B1, 10, 1), BLOCKED, 'checker belongs to another seat');
});

test('two enemy checkers block a point, from either enemy seat', () => {
  assert.equal(pos({ 10: 't1:1', 7: 'b1:2' }).stepTarget(T1, 10, 3), BLOCKED);
  assert.equal(pos({ 10: 't1:1', 7: 'b1:1+b2:1' }).stepTarget(T1, 10, 3), BLOCKED);
});

test('teammates stack freely and never pin each other', () => {
  const p = pos({ 10: 't1:1', 7: 't2:3' });
  assert.equal(p.stepTarget(T1, 10, 3), 7);
  p.applyStep(T1, 10, 3);
  assert.equal(pointText(p, 7), 't1:1+t2:3');
  assert.equal(p.pinned[7], -1);

  const q = pos({ 10: 't1:1', 7: 't2:1' });
  q.applyStep(T1, 10, 3);
  assert.equal(q.pinned[7], -1);
});

test('landing on a lone enemy checker pins it', () => {
  const p = pos({ 10: 't1:1', 7: 'b1:1' });
  assert.equal(p.stepTarget(T1, 10, 3), 7);
  p.applyStep(T1, 10, 3);
  assert.equal(pointText(p, 7), 't1:1+b1:1!');
  assert.equal(p.pinned[7], B1);
  assert.deepEqual(p.checkInvariants({ conservation: false }), []);
});

test('a pinned checker cannot move', () => {
  const p = pos({ 7: 't1:1+b1:1!', 3: 'b1:1' });
  assert.equal(p.stepTarget(B1, 7, 1), BLOCKED);
  assert.ok(!p.legalFroms(B1, 2).includes(7));
  assert.ok(p.legalFroms(B1, 2).includes(3));
});

test('a pinned point is closed to the pinned team but open to the pinner team', () => {
  const closed = pos({ 7: 't1:1+b1:1!', 4: 'b2:1' });
  assert.equal(closed.stepTarget(B2, 4, 3), BLOCKED);

  const open = pos({ 7: 't1:1+b1:1!', 10: 't2:1' });
  assert.equal(open.stepTarget(T2, 10, 3), 7);
  open.applyStep(T2, 10, 3);
  assert.equal(pointText(open, 7), 't1:1+b1:1!+t2:1');
  assert.equal(open.pinned[7], B1);
});

test('the pin ends only when the last pinner leaves', () => {
  const p = pos({ 7: 't1:1+t2:1+b1:1!', 20: 'b2:1' });
  const first = p.applyStep(T1, 7, 2);
  assert.equal(p.pinned[7], B1);
  assert.equal(p.stepTarget(B1, 7, 1), BLOCKED);
  const second = p.applyStep(T2, 7, 3);
  assert.equal(p.pinned[7], -1);
  assert.equal(pointText(p, 7), 'b1:1');
  assert.notEqual(p.stepTarget(B1, 7, 1), BLOCKED);

  p.undoStep(second);
  assert.equal(p.pinned[7], B1);
  p.undoStep(first);
  assert.equal(pointText(p, 7), 't1:1+b1:1!+t2:1');
});

test('a pinner bearing off releases the pin', () => {
  const p = pos({ 3: 't1:1+b1:1!', 22: 'b2:1' });
  // t1 is the pinner at point 3 and its only checker, so it may bear off once home.
  assert.equal(p.stepTarget(T1, 3, 3), OFF);
  p.applyStep(T1, 3, 3);
  assert.equal(p.pinned[3], -1);
  assert.equal(p.off[T1], 1);
});

test('bear-off needs every checker home and respects the exact-or-higher rule', () => {
  assert.equal(pos({ 3: 't1:1', 10: 't1:1' }).stepTarget(T1, 3, 5), BLOCKED, 'a checker is still outside home');

  const single = pos({ 3: 't1:1' });
  assert.equal(single.stepTarget(T1, 3, 3), OFF);
  assert.equal(single.stepTarget(T1, 3, 5), OFF, 'higher die, nothing farther back');
  assert.equal(single.stepTarget(T1, 3, 2), 1);

  const two = pos({ 3: 't1:1', 5: 't1:1' });
  assert.equal(two.stepTarget(T1, 3, 3), OFF, 'exact die is always fine');
  assert.equal(two.stepTarget(T1, 3, 6), BLOCKED, 'a farther checker must move first');
  assert.equal(two.stepTarget(T1, 5, 6), OFF);

  const bottom = pos({ 22: 'b1:1' });
  assert.equal(bottom.stepTarget(B1, 22, 3), OFF);
  assert.equal(bottom.stepTarget(B1, 22, 5), OFF);
  assert.equal(bottom.stepTarget(B1, 22, 1), 23);
});

test('a pinned checker at home still holds back higher-die bear-offs', () => {
  const p = pos({ 6: 't1:1!+b1:1', 3: 't1:1' });
  assert.equal(p.stepTarget(T1, 3, 5), BLOCKED);
  assert.equal(p.stepTarget(T1, 3, 3), OFF);
  assert.equal(p.stepTarget(T1, 6, 6), BLOCKED, 'pinned');
});

test('start stacks are not in home, so nobody can bear off at the start', () => {
  const p = Position.initial(rules);
  for (const s of [T1, B1, T2, B2]) {
    assert.ok(!p.allHome(s));
    for (let die = 1; die <= 6; die++) {
      for (const from of p.legalFroms(s, die)) assert.notEqual(p.stepTarget(s, from, die), OFF);
    }
  }
});

test('every first move is legal at the start', () => {
  const p = Position.initial(rules);
  for (const s of [T1, B1, T2, B2]) {
    for (let die = 1; die <= 6; die++) assert.deepEqual(p.legalFroms(s, die), [rules.startPoint[s]]);
  }
});

test('applyStep followed by undoStep restores text, hash and invariants', () => {
  const rng = createRng(11);
  for (let game = 0; game < 25; game++) {
    const p = Position.initial(rules);
    const trail = [];
    for (let i = 0; i < 400; i++) {
      const s = rng.int(4);
      const die = rng.die();
      const froms = p.legalFroms(s, die);
      if (froms.length === 0) continue;
      const before = p.toText();
      const key = p.key();
      const rec = p.applyStep(s, froms[rng.int(froms.length)], die);
      assert.deepEqual(p.checkInvariants(), [], `after ${before}`);
      trail.push({ rec, before, key });
    }
    while (trail.length) {
      const { rec, before, key } = trail.pop();
      p.undoStep(rec);
      assert.equal(p.toText(), before);
      assert.equal(p.key(), key);
    }
    assert.ok(p.sameAs(Position.initial(rules)));
  }
});

test('position keys differ after a step and match for identical positions', () => {
  const a = Position.initial(rules);
  const b = Position.initial(rules);
  assert.equal(a.key(), b.key());
  assert.ok(Number.isSafeInteger(a.key()));
  a.applyStep(T1, 24, 6);
  assert.notEqual(a.key(), b.key());
  b.applyStep(T1, 24, 6);
  assert.equal(a.key(), b.key());
});

test('text form round-trips and rejects malformed input', () => {
  const rng = createRng(5);
  const p = Position.initial(rules);
  for (let i = 0; i < 300; i++) {
    const s = rng.int(4);
    const die = rng.die();
    const froms = p.legalFroms(s, die);
    if (froms.length) p.applyStep(s, froms[rng.int(froms.length)], die);
    const copy = Position.fromText(rules, p.toText());
    assert.ok(copy.sameAs(p));
    assert.equal(copy.key(), p.key());
  }
  assert.throws(() => Position.fromText(rules, 'nope'), /points/);
  assert.throws(() => Position.fromText(rules, `${Array(23).fill('.').join('/')} 0,0,0,0`), /expected 24/);
  assert.throws(() => Position.fromText(rules, `x:1/${Array(23).fill('.').join('/')} 0,0,0,0`), /bad token|unknown/);
  assert.throws(() => Position.fromText(rules, `t1:9/${Array(23).fill('.').join('/')} 0,0,0,0`), /bad count/);
  assert.throws(() => Position.fromText(rules, `${Array(24).fill('.').join('/')} 0,0,0`), /off counts/);
});
