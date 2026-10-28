// Browser stand-in for the parts of node:crypto used by the shared room code.
export function randomInt(min, max) {
  if (max === undefined) {
    max = min;
    min = 0;
  }
  const range = max - min;
  const limit = 4294967296 - (4294967296 % range);
  const buf = new Uint32Array(1);
  do globalThis.crypto.getRandomValues(buf); while (buf[0] >= limit);
  return min + (buf[0] % range);
}

export function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

export default { randomInt, randomBytes };
