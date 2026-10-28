import { createRng } from './rng.js';

// 53-bit Zobrist keys (32 low + 21 high bits) so a position key fits in a safe JS integer.
export function buildZobrist(numPoints, seatCount, maxCount) {
  const rng = createRng(0x7a6f6272);
  const width = maxCount + 1;

  const table = (size, zeroEvery, zeroOffset) => {
    const lo = new Int32Array(size);
    const hi = new Int32Array(size);
    for (let i = 0; i < size; i++) {
      lo[i] = rng.next32() | 0;
      hi[i] = rng.next32() & 0x1fffff;
    }
    // Index 0 of every slot means "empty" and must not contribute to the hash.
    for (let i = zeroOffset; i < size; i += zeroEvery) {
      lo[i] = 0;
      hi[i] = 0;
    }
    return { lo, hi };
  };

  return {
    maxCount,
    count: table((numPoints + 1) * seatCount * width, width, 0),
    pin: table((numPoints + 1) * (seatCount + 1), seatCount + 1, 0),
    off: table(seatCount * width, width, 0),
  };
}
