// Seeded sfc32 PRNG for simulation and training. Production dice must come from a CSPRNG on the server.

function splitmix32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function createRng(seed = 1) {
  const sm = splitmix32(seed);
  let a = sm();
  let b = sm();
  let c = sm();
  let d = sm();

  function next32() {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  }

  function int(n) {
    if (!(n >= 1 && n <= 4294967296)) throw new RangeError('int(n): n must be in [1, 2^32]');
    const limit = 4294967296 - (4294967296 % n);
    let x = next32();
    while (x >= limit) x = next32();
    return x % n;
  }

  const die = () => int(6) + 1;
  const roll = () => [die(), die()];
  const float = () => next32() / 4294967296;

  for (let i = 0; i < 12; i++) next32();
  return { next32, int, die, roll, float };
}
