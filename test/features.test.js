import test from 'node:test';
import assert from 'node:assert/strict';
import { Position, QUADRANT_PLAKOTO_4P, compileVariant, createRng, reverseCycle, withCheckersPerSeat } from '../engine/index.js';
import { DENSE_COUNT, MAX_ACTIVE, SPARSE_COUNT, createFeatureBuffer, encoderFor, expand } from '../bots/features.js';
import { createRandomBot } from '../bots/random.js';
import { playGame } from '../bots/arena.js';
import { rules as forward, pos } from '../testkit/helpers.js';

const reversedRules = compileVariant(reverseCycle(QUADRANT_PLAKOTO_4P));
const SWAP = { t1: 'b1', b1: 't1', t2: 'b2', b2: 't2' };

// The same game turned upside down: Top and Bottom swap seats and points are mirrored. The turn cycle then runs the other way.
function mirror(position, toRules) {
  const R = position.rules;
  const points = [];
  for (let p = 1; p <= R.N; p++) {
    const q = R.N + 1 - p;
    const tokens = [];
    for (let s = 0; s < R.S; s++) {
      const c = position.countAt(q, s);
      if (c > 0) tokens.push(`${SWAP[R.seatIds[s]]}:${c}${position.pinned[q] === s ? '!' : ''}`);
    }
    points.push(tokens.length ? tokens.join('+') : '.');
  }
  const off = toRules.seatIds.map((id) => position.off[R.seatIndex.get(SWAP[id])]);
  return Position.fromText(toRules, `${points.join('/')} ${off.join(',')}`);
}

const features = (rules, position, team, nextSlot) => {
  const feat = encoderFor(rules).encode(position, team, nextSlot, createFeatureBuffer());
  return { idx: [...feat.idx.subarray(0, feat.n)].sort((a, b) => a - b), dense: [...feat.dense] };
};

test('the layout of the inputs is fixed: counts, pins, off, next slot, next actor, direction, team units', () => {
  assert.equal(SPARSE_COUNT, 1001);
  assert.equal(DENSE_COUNT, 16);
  assert.ok(MAX_ACTIVE >= 32 + 24 + 3 + 48);
  const start = Position.initial(forward);
  const f = features(forward, start, 0, 1);
  // Top just moved: seat 0 (t1) has eight checkers on canonical point 24, seat 1 (t2) eight on 18, then b1 on 1 and b2 on 7.
  const expectedCounts = [];
  for (const [seat, point] of [[0, 24], [1, 18], [2, 1], [3, 7]]) {
    for (let k = 0; k < 8; k++) expectedCounts.push((seat * 24 + (point - 1)) * 8 + k);
  }
  assert.deepEqual(f.idx.filter((i) => i < 768), expectedCounts.sort((a, b) => a - b));
  assert.deepEqual(f.idx.filter((i) => i >= 768 && i < 896), [], 'no pins and nothing borne off at the start');
  // The next slot is b1's (seat 1 in order t1, b1, t2, b2): canonical seat 2 for Top; its actor is the same seat.
  assert.deepEqual(f.idx.filter((i) => i >= 896 && i < 905), [896 + 2, 900 + 2]);
  // Team units: my two points (24 and 18) and the enemy's two (1 and 7) are all safe points.
  assert.deepEqual(f.idx.filter((i) => i >= 905), [905 + 2 * 17 + 1, 905 + 2 * 23 + 1, 905 + 2 * (24 + 0) + 1, 905 + 2 * (24 + 6) + 1]);
  assert.deepEqual(f.dense, [0, 1, 1, 0, 0, 0, 0, 2 / 12, 2 / 12, 0, 0, 0, 0, 1, 1, 1].map(Math.fround));
});

test('every position gives 32 checker units, one unit per pin and the context units', () => {
  const rng = createRng(4);
  const buffer = createFeatureBuffer();
  const seen = new Set();
  for (let seed = 1; seed <= 6; seed++) {
    const bot = createRandomBot(rng);
    playGame({
      botFor: () => bot,
      seed,
      onTurn: (game) => {
        const team = game.rules.teamOf[game.history.at(-1).actor];
        const f = encoderFor(game.rules).encode(game.position, team, game.slot, buffer);
        const idx = [...f.idx.subarray(0, f.n)];
        assert.equal(new Set(idx).size, idx.length, 'no input is switched on twice');
        assert.ok(idx.every((i) => i < SPARSE_COUNT));
        const pins = game.position.pinned.reduce((n, p) => n + (p >= 0 ? 1 : 0), 0);
        assert.equal(idx.filter((i) => i < 768).length + idx.filter((i) => i >= 864 && i < 896).length, 32);
        assert.equal(idx.filter((i) => i >= 768 && i < 864).length, pins);
        assert.equal(idx.filter((i) => i >= 896 && i < 904).length, 2);
        let occupied = 0;
        for (let p = 1; p <= 24; p++) for (const side of [0, 1]) if (game.position.teamCountAt(p, side) > 0) occupied++;
        assert.equal(idx.filter((i) => i >= 905).length, occupied, 'one team unit per occupied point and team');
        seen.add(pins);
      },
    });
  }
  assert.ok(seen.size > 2, 'the games contained pins');
});

test('the encoding is exactly mirror symmetric: Top\'s view of a position equals Bottom\'s view of its mirror image', () => {
  const rng = createRng(9);
  let compared = 0;
  let late = 0;
  for (let seed = 1; seed <= 14; seed++) {
    const bot = createRandomBot(rng);
    playGame({
      botFor: () => bot,
      seed,
      cycle: seed % 2 ? 'forward' : 'reverse',
      onTurn: (game) => {
        if (game.over) return;
        const R = game.rules;
        const team = R.teamOf[game.history.at(-1).actor];
        const other = R === forward ? reversedRules : forward;
        const slotSeatId = R.seatIds[R.turnOrder[game.slot]];
        const mirroredSlot = other.turnOrder.indexOf(other.seatIndex.get(SWAP[slotSeatId]));
        const here = features(R, game.position, team, game.slot);
        const there = features(other, mirror(game.position, other), 1 - team, mirroredSlot);
        assert.deepEqual(there.idx, here.idx);
        here.dense.forEach((v, i) => assert.ok(Math.abs(v - there.dense[i]) < 1e-6, `dense input ${i}: ${v} vs ${there.dense[i]}`));
        compared++;
        if (game.position.off.some((n) => n === 8)) late++;
      },
    });
  }
  assert.ok(compared > 800);
  assert.ok(late > 20, 'finished seats (teammate plays for them) were covered');
});

test('the start position looks the same to both teams', () => {
  const start = Position.initial(forward);
  const top = features(forward, start, 0, 1);
  const bottom = features(forward, start, 1, 2);
  assert.deepEqual(top.idx.filter((i) => i < 768), bottom.idx.filter((i) => i < 768));
  assert.deepEqual(top.dense, bottom.dense);
});

test('pins are recorded with the canonical seat of the pinned checker', () => {
  // b1 is pinned on point 13 by a t1 checker; the position is not a complete game state, which is fine for the encoder.
  const p = pos({ 13: 't1:1+b1:1!' });
  const asTop = features(forward, p, 0, 1);
  assert.deepEqual(asTop.idx.filter((i) => i >= 768 && i < 864), [768 + (13 - 1) * 4 + 2], 'b1 is canonical seat 2 for Top');
  const asBottom = features(forward, p, 1, 2);
  assert.deepEqual(asBottom.idx.filter((i) => i >= 768 && i < 864), [768 + (25 - 13 - 1) * 4 + 0], 'b1 is canonical seat 0 for Bottom, on the mirrored point');
});

test('dense inputs describe the race', () => {
  const f = encoderFor(forward).encode(pos({ 1: 't1:2' }), 0, 1, createFeatureBuffer());
  assert.ok(Math.abs(f.dense[1] - 2 / 336) < 1e-7, 'two checkers on point 1 need two pips');
  assert.equal(f.dense[2], 0);
  assert.ok(Math.abs(f.dense[0] - -2 / 50) < 1e-7);
  const far = encoderFor(forward).encode(pos({ 24: 't1:8', 18: 't2:8' }), 1, 1, createFeatureBuffer());
  assert.equal(far.dense[0], 4, 'the race term is clamped to [-4, 4]');
});

test('dense inputs count exposed checkers: a lone checker six pips in front of an enemy stack', () => {
  // t1 is alone on 10 and b1's eight checkers on 4 are 6 pips behind it: 17 of 36 rolls hit.
  const p = pos({ 10: 't1:1', 4: 'b1:8' });
  const asTop = encoderFor(forward).encode(p, 0, 1, createFeatureBuffer());
  assert.ok(Math.abs(asTop.dense[3] - 17 / 36 / 3) < 1e-6);
  assert.ok(Math.abs(asTop.dense[4] - ((17 / 36) * (10 + 0.5 * 10)) / 40) < 1e-6);
  assert.equal(asTop.dense[5], 0, 'the enemy has no lone checker');
  const asBottom = encoderFor(forward).encode(p, 1, 2, createFeatureBuffer());
  assert.equal(asBottom.dense[3], 0);
  assert.ok(asBottom.dense[5] > 0, 'seen from the other side it is a target');
});

test('dense inputs count safe points, pins and stuck seats', () => {
  const p = pos({ 13: 't1:2', 5: 'b1:3', 9: 't2:1+b2:1!' });
  const asTop = encoderFor(forward).encode(p, 0, 1, createFeatureBuffer());
  assert.equal(asTop.dense[7], Math.fround(1 / 12), 'one safe point of mine');
  assert.equal(asTop.dense[8], Math.fround(1 / 12), 'one safe point of theirs');
  assert.equal(asTop.dense[9], 0);
  assert.equal(asTop.dense[10], 1 / 4, 'one enemy checker is pinned');
  assert.equal(asTop.dense[11], 0);
  assert.equal(asTop.dense[12], 1 / 2, 'b2 has nothing but the pinned checker left');
  const asBottom = encoderFor(forward).encode(p, 1, 2, createFeatureBuffer());
  assert.deepEqual([asBottom.dense[9], asBottom.dense[10], asBottom.dense[11], asBottom.dense[12]], [1 / 4, 0, 1 / 2, 0].map(Math.fround));
});

test('contact ends when the teams have passed each other', () => {
  // Top has three checkers on 12 and Bottom two on 10: they still have to get past each other.
  const contact = encoderFor(forward).encode(pos({ 12: 't1:3', 10: 'b1:2' }), 0, 1, createFeatureBuffer());
  assert.equal(contact.dense[13], 1);
  assert.equal(contact.dense[14], 3 / 16);
  assert.equal(contact.dense[15], 2 / 16);
  const swapped = encoderFor(forward).encode(pos({ 12: 't1:3', 10: 'b1:2' }), 1, 2, createFeatureBuffer());
  assert.deepEqual([swapped.dense[14], swapped.dense[15]], [2 / 16, 3 / 16]);
  // Top is on 3 and Bottom on 20: nothing is left to pass, a pure race.
  const race = encoderFor(forward).encode(pos({ 3: 't1:2', 20: 'b1:2' }), 0, 1, createFeatureBuffer());
  assert.deepEqual([race.dense[13], race.dense[14], race.dense[15]], [0, 0, 0]);
});

test('expand turns a buffer into a dense vector', () => {
  const f = encoderFor(forward).encode(Position.initial(forward), 0, 1, createFeatureBuffer());
  const x = expand(f);
  assert.equal(x.length, SPARSE_COUNT + DENSE_COUNT);
  assert.equal(x.slice(0, SPARSE_COUNT).reduce((a, b) => a + b, 0), f.n);
  assert.deepEqual([...x.slice(SPARSE_COUNT)], [...f.dense]);
});

test('feature set 2 refuses boards it was not designed for', () => {
  assert.throws(() => encoderFor(compileVariant(withCheckersPerSeat(QUADRANT_PLAKOTO_4P, 9))), /8 checkers/);
  const straight = Object.freeze({ ...QUADRANT_PLAKOTO_4P, turnOrder: Object.freeze([0, 2, 1, 3]) });
  assert.throws(() => encoderFor(compileVariant(straight)), /alternate/);
});
