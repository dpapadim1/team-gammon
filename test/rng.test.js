import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../engine/index.js';

test('same seed gives the same stream, different seeds differ', () => {
  const a = createRng(42);
  const b = createRng(42);
  const c = createRng(43);
  const sa = Array.from({ length: 50 }, () => a.next32());
  const sb = Array.from({ length: 50 }, () => b.next32());
  const sc = Array.from({ length: 50 }, () => c.next32());
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
});

test('dice are uniform on 1..6 and stay in range', () => {
  const rng = createRng(7);
  const counts = new Array(7).fill(0);
  const n = 60000;
  for (let i = 0; i < n; i++) counts[rng.die()]++;
  assert.equal(counts[0], 0);
  for (let d = 1; d <= 6; d++) {
    assert.ok(Math.abs(counts[d] - n / 6) < n / 6 * 0.05, `face ${d}: ${counts[d]}`);
  }
});

test('int(n) is bounded and rejects bad ranges', () => {
  const rng = createRng(1);
  for (let i = 0; i < 1000; i++) {
    const x = rng.int(4);
    assert.ok(Number.isInteger(x) && x >= 0 && x < 4);
  }
  assert.equal(rng.int(1), 0);
  assert.throws(() => rng.int(0), RangeError);
  assert.throws(() => rng.int(-3), RangeError);
});

test('roll returns two dice', () => {
  const rng = createRng(9);
  for (let i = 0; i < 100; i++) {
    const [a, b] = rng.roll();
    assert.ok(a >= 1 && a <= 6 && b >= 1 && b <= 6);
  }
});
