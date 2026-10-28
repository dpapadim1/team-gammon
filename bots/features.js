import { exposure, foesAfter, stuckBehindPin } from './heuristic.js';

// Input encoding of the value network (version 2).
//
// A position is described from the point of view of the team that has just moved ("me"): the board is mirrored top to
// bottom when that team is the Bottom team, so the network always sees its own seats on the same points. The sparse
// inputs are binary; the 32 checkers always contribute exactly 32 active units. The dense inputs are numbers around
// one that summarise the race, exposed checkers, safe points, pins and contact.
export const FEATURES_VERSION = 2;

const POINTS = 24;
const SEATS = 4;
const LEVELS = 8; // thermometer steps per count: a stack of 3 switches on steps 1, 2 and 3

const COUNTS = 0; // [canonical seat][canonical point][step]
const PINS = COUNTS + SEATS * POINTS * LEVELS; // [canonical point][canonical seat of the pinned checker]
const OFF = PINS + POINTS * SEATS; // [canonical seat][step]
const NEXT_SLOT = OFF + SEATS * LEVELS; // seat whose turn slot comes next
const NEXT_ACTOR = NEXT_SLOT + SEATS; // seat that will really play it (a finished seat's teammate plays for it)
const DIRECTION = NEXT_ACTOR + SEATS; // 1 when the second player after me's first seat is not the enemy's first seat
const TEAM_UNITS = DIRECTION + 1; // [mine, enemy][canonical point][one checker, two or more]: team level, seats added together

export const SPARSE_COUNT = TEAM_UNITS + 2 * POINTS * 2;
export const DENSE_COUNT = 16;
export const MAX_ACTIVE = 112; // at most 32 checker units + 24 pins + 3 context units + 48 team units
const PIP_SCALE = 336; // pips of a team at the start

// Dense inputs, in order:
//  0 race lead /50 (clamped to +-4)   1 my pips /336     2 enemy pips /336
//  3 my exposed checkers /3           4 their cost /40   5 enemy exposed checkers /3   6 their cost /40
//  7 my safe points /12               8 enemy safe points /12
//  9 my pinned checkers /4           10 enemy pinned checkers /4   11 my stuck seats /2   12 enemy stuck seats /2
// 13 contact (some checkers still have to pass each other)   14 my checkers still to pass /16   15 enemy checkers still to pass /16

export function createFeatureBuffer() {
  return { idx: new Uint16Array(MAX_ACTIVE), n: 0, dense: new Float32Array(DENSE_COUNT) };
}

// Canonical seats: 0 and 1 are my seats (farthest start first), 2 and 3 the enemy seats in the same order.
function teamTable(rules, team) {
  const farthest = (a, b) => rules.dist[b][rules.startPoint[b]] - rules.dist[a][rules.startPoint[a]];
  const mine = [...rules.teamSeats[team]].sort(farthest);
  const foes = [...rules.teamSeats[1 - team]].sort(farthest);
  if (mine.length !== 2 || foes.length !== 2) throw new Error('the value network needs two seats per team');
  const seatCanon = new Int8Array(SEATS);
  mine.forEach((s, i) => { seatCanon[s] = i; });
  foes.forEach((s, i) => { seatCanon[s] = 2 + i; });
  const mirror = rules.dir[mine[0]] > 0;
  const pointCanon = new Int8Array(POINTS + 1);
  for (let p = 1; p <= POINTS; p++) pointCanon[p] = mirror ? POINTS + 1 - p : p;
  const order = rules.turnOrder;
  const after = order[(order.indexOf(mine[0]) + 1) % SEATS];
  if (after !== foes[0] && after !== foes[1]) throw new Error('the value network needs the teams to alternate');
  return {
    mine,
    foes,
    seatCanon,
    pointCanon,
    direction: after === foes[0] ? 0 : 1,
    layout: [...mine, ...foes].map((s) => pointCanon[rules.startPoint[s]]).join(),
  };
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export class FeatureEncoder {
  constructor(rules) {
    if (rules.N !== POINTS || rules.S !== SEATS || rules.checkersPerSeat > LEVELS) {
      throw new Error('feature set 2 needs the 24-point board, four seats and at most 8 checkers per seat');
    }
    this.rules = rules;
    this.teams = [teamTable(rules, 0), teamTable(rules, 1)];
    if (this.teams[0].layout !== this.teams[1].layout) throw new Error('the two teams do not start on mirrored points');
    if (!rules.teamSeats[0].every((s) => rules.dir[s] < 0) || !rules.teamSeats[1].every((s) => rules.dir[s] > 0)) {
      throw new Error('feature set 2 needs team 0 to move towards point 1');
    }
    this.top = new Int8Array(POINTS + 1); // checkers of team 0 and team 1 on each point
    this.bottom = new Int8Array(POINTS + 1);
  }

  // Fills `out` with the features of `position`, which `team` has just produced by playing; `nextSlot` is the turn slot that follows.
  encode(position, team, nextSlot, out) {
    const R = this.rules;
    const t = this.teams[team];
    const { idx, dense } = out;
    const { seatCanon, pointCanon } = t;
    const counts = position.counts;
    const top = this.top;
    const bottom = this.bottom;
    const [m0, m1] = t.mine;
    const [f0, f1] = t.foes;
    let n = 0;
    let madeMine = 0;
    let madeFoe = 0;
    let pinnedMine = 0;
    let pinnedFoe = 0;
    let stuckMine = 0;
    let stuckFoe = 0;
    for (let p = 1; p <= POINTS; p++) {
      const pc = pointCanon[p] - 1;
      const row = p * SEATS;
      for (let s = 0; s < SEATS; s++) {
        const c = counts[row + s];
        if (c === 0) continue;
        const base = COUNTS + (seatCanon[s] * POINTS + pc) * LEVELS;
        for (let k = 0; k < c; k++) idx[n++] = base + k;
      }
      const mine = counts[row + m0] + counts[row + m1];
      const foes = counts[row + f0] + counts[row + f1];
      if (mine > 0) idx[n++] = TEAM_UNITS + pc * 2 + (mine >= 2 ? 1 : 0);
      if (foes > 0) idx[n++] = TEAM_UNITS + (POINTS + pc) * 2 + (foes >= 2 ? 1 : 0);
      top[p] = team === 0 ? mine : foes;
      bottom[p] = team === 0 ? foes : mine;
      const pin = position.pinned[p];
      if (pin >= 0) {
        idx[n++] = PINS + pc * SEATS + seatCanon[pin];
        const own = seatCanon[pin] < 2;
        if (own) pinnedMine++;
        else pinnedFoe++;
        if (stuckBehindPin(position, pin, p)) {
          if (own) stuckMine++;
          else stuckFoe++;
        }
      } else if (foes === 0 && mine >= 2) {
        madeMine++;
      } else if (mine === 0 && foes >= 2) {
        madeFoe++;
      }
    }
    for (let s = 0; s < SEATS; s++) {
      const base = OFF + seatCanon[s] * LEVELS;
      const off = position.off[s];
      for (let k = 0; k < off; k++) idx[n++] = base + k;
    }
    const slotSeat = R.turnOrder[nextSlot % SEATS];
    let actor = slotSeat;
    if (position.isFinished(slotSeat)) {
      for (const mate of R.mates[slotSeat]) {
        if (!position.isFinished(mate)) {
          actor = mate;
          break;
        }
      }
    }
    idx[n++] = NEXT_SLOT + seatCanon[slotSeat];
    idx[n++] = NEXT_ACTOR + seatCanon[actor];
    if (t.direction === 1) idx[n++] = DIRECTION;
    if (n > MAX_ACTIVE) throw new RangeError(`position has ${n} active features, more than ${MAX_ACTIVE}`);
    out.n = n;

    const myPips = position.pipsLeft(m0) + position.pipsLeft(m1);
    const foePips = position.pipsLeft(f0) + position.pipsLeft(f1);
    const mover = (nextSlot + SEATS - 1) % SEATS;
    const mineExposed = exposure(position, team, foesAfter(R, position, mover, team));
    const foeExposed = exposure(position, 1 - team, foesAfter(R, position, nextSlot, 1 - team));

    let maxTop = 0;
    let minBottom = POINTS + 1;
    for (let p = 1; p <= POINTS; p++) {
      if (top[p] > 0 && p > maxTop) maxTop = p;
      if (bottom[p] > 0 && p < minBottom) minBottom = p;
    }
    let topBehind = 0;
    let bottomBehind = 0;
    for (let p = 1; p <= POINTS; p++) {
      if (p > minBottom) topBehind += top[p];
      if (p < maxTop) bottomBehind += bottom[p];
    }

    dense[0] = clamp((foePips - myPips) / 50, -4, 4);
    dense[1] = myPips / PIP_SCALE;
    dense[2] = foePips / PIP_SCALE;
    dense[3] = mineExposed.expected / 3;
    dense[4] = mineExposed.cost / 40;
    dense[5] = foeExposed.expected / 3;
    dense[6] = foeExposed.cost / 40;
    dense[7] = madeMine / 12;
    dense[8] = madeFoe / 12;
    dense[9] = pinnedMine / 4;
    dense[10] = pinnedFoe / 4;
    dense[11] = stuckMine / 2;
    dense[12] = stuckFoe / 2;
    dense[13] = maxTop > minBottom ? 1 : 0;
    dense[14] = (team === 0 ? topBehind : bottomBehind) / 16;
    dense[15] = (team === 0 ? bottomBehind : topBehind) / 16;
    return out;
  }
}

const encoders = new WeakMap();

export function encoderFor(rules) {
  let encoder = encoders.get(rules);
  if (!encoder) {
    encoder = new FeatureEncoder(rules);
    encoders.set(rules, encoder);
  }
  return encoder;
}

// Dense expansion of a feature buffer, for reference implementations and tests.
export function expand(feat) {
  const out = new Float32Array(SPARSE_COUNT + DENSE_COUNT);
  for (let i = 0; i < feat.n; i++) out[feat.idx[i]] += 1;
  for (let d = 0; d < DENSE_COUNT; d++) out[SPARSE_COUNT + d] = feat.dense[d];
  return out;
}
