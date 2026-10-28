import { buildZobrist } from './zobrist.js';

// Points are numbered 1..numPoints as in standard backgammon seen from the Top team.
// A seat moves towards point 1 (dir -1) or towards numPoints (dir +1) and bears off past the last point.
// startSanctuary: a lone checker standing on its own seat's start point cannot be pinned.
export const QUADRANT_PLAKOTO_4P = Object.freeze({
  id: 'quadrant-plakoto-4p',
  name: 'Quadrant Plakoto (4 players)',
  numPoints: 24,
  homeSize: 6,
  checkersPerSeat: 8,
  startSanctuary: true,
  teams: Object.freeze([
    Object.freeze({ id: 'top', name: 'Top' }),
    Object.freeze({ id: 'bottom', name: 'Bottom' }),
  ]),
  seats: Object.freeze([
    Object.freeze({ id: 't1', team: 0, start: 24, dir: -1 }),
    Object.freeze({ id: 'b1', team: 1, start: 1, dir: 1 }),
    Object.freeze({ id: 't2', team: 0, start: 18, dir: -1 }),
    Object.freeze({ id: 'b2', team: 1, start: 7, dir: 1 }),
  ]),
  turnOrder: Object.freeze([0, 1, 2, 3]),
});

export function withCheckersPerSeat(variant, checkersPerSeat) {
  return Object.freeze({ ...variant, checkersPerSeat });
}

const reversed = new WeakMap();

// Same variant with the turn cycle walked the other way round, keeping the first seat first. Memoised so rules compile once.
export function reverseCycle(variant) {
  let rev = reversed.get(variant);
  if (!rev) {
    const [first, ...rest] = variant.turnOrder;
    rev = Object.freeze({ ...variant, turnOrder: Object.freeze([first, ...rest.reverse()]) });
    reversed.set(variant, rev);
    reversed.set(rev, variant);
  }
  return rev;
}

const layout = (id, name, starts) => Object.freeze({
  ...QUADRANT_PLAKOTO_4P,
  id,
  name,
  seats: Object.freeze([
    Object.freeze({ id: 't1', team: 0, start: starts[0], dir: -1 }),
    Object.freeze({ id: 'b1', team: 1, start: starts[1], dir: 1 }),
    Object.freeze({ id: 't2', team: 0, start: starts[2], dir: -1 }),
    Object.freeze({ id: 'b2', team: 1, start: starts[3], dir: 1 }),
  ]),
});

// Alternatives used only by the variant explorer (start points in seat order t1, b1, t2, b2).
export const CORNER_TOP_BOTTOM_4P = layout('corner-top-bottom-4p', 'Corner starts, Top vs Bottom', [24, 1, 13, 12]);
export const CORNER_DIAGONAL_4P = layout('corner-diagonal-4p', 'Corner starts, diagonal teams', [24, 1, 12, 13]);

// Plain Plakoto pinning without the sanctuary: mutual pins on the start corners can stalemate a game.
export const QUADRANT_PLAIN_4P = Object.freeze({
  ...QUADRANT_PLAKOTO_4P,
  id: 'quadrant-plain-4p',
  name: 'Quadrant Plakoto, plain pinning',
  startSanctuary: false,
});

export const VARIANTS = Object.freeze({
  [QUADRANT_PLAKOTO_4P.id]: QUADRANT_PLAKOTO_4P,
  [QUADRANT_PLAIN_4P.id]: QUADRANT_PLAIN_4P,
  [CORNER_TOP_BOTTOM_4P.id]: CORNER_TOP_BOTTOM_4P,
  [CORNER_DIAGONAL_4P.id]: CORNER_DIAGONAL_4P,
});

const SEAT_ID = /^[A-Za-z][A-Za-z0-9_]*$/;
const cache = new WeakMap();

function fail(message) {
  throw new Error(`Invalid variant: ${message}`);
}

export function compileVariant(variant) {
  const cached = cache.get(variant);
  if (cached) return cached;

  const { numPoints: N, homeSize, checkersPerSeat, teams, seats, turnOrder } = variant;
  if (!Number.isInteger(N) || N < 2 || N > 100) fail('numPoints must be an integer in [2, 100]');
  if (!Number.isInteger(homeSize) || homeSize < 1 || homeSize > N) fail('homeSize must be in [1, numPoints]');
  if (!Number.isInteger(checkersPerSeat) || checkersPerSeat < 1 || checkersPerSeat > 100) fail('checkersPerSeat must be in [1, 100]');
  if (!Array.isArray(teams) || teams.length !== 2) fail('exactly two teams are supported');
  if (!Array.isArray(seats) || seats.length < 2) fail('at least two seats are required');

  const S = seats.length;
  const seatIds = seats.map((seat) => seat.id);
  const ids = new Set();
  for (const seat of seats) {
    if (typeof seat.id !== 'string' || !SEAT_ID.test(seat.id)) fail(`bad seat id ${JSON.stringify(seat.id)}`);
    if (ids.has(seat.id)) fail(`duplicate seat id ${seat.id}`);
    ids.add(seat.id);
    if (seat.team !== 0 && seat.team !== 1) fail(`seat ${seat.id}: team must be 0 or 1`);
    if (!Number.isInteger(seat.start) || seat.start < 1 || seat.start > N) fail(`seat ${seat.id}: start out of range`);
    if (seat.dir !== -1 && seat.dir !== 1) fail(`seat ${seat.id}: dir must be -1 or 1`);
  }
  const teamSeats = [0, 1].map((t) => seats.flatMap((seat, i) => (seat.team === t ? [i] : [])));
  if (teamSeats[0].length === 0 || teamSeats[1].length === 0) fail('each team needs at least one seat');
  for (const a of teamSeats[0]) {
    for (const b of teamSeats[1]) {
      if (seats[a].start === seats[b].start) fail(`seats ${seats[a].id} and ${seats[b].id} of different teams share a start point`);
    }
  }
  if (!Array.isArray(turnOrder) || turnOrder.length !== S || new Set(turnOrder).size !== S
    || !turnOrder.every((s) => Number.isInteger(s) && s >= 0 && s < S)) {
    fail('turnOrder must list every seat index exactly once');
  }

  const teamOf = Int8Array.from(seats, (seat) => seat.team);
  const dir = Int8Array.from(seats, (seat) => seat.dir);
  const startPoint = Int8Array.from(seats, (seat) => seat.start);
  // dist[s][p]: pips seat s still needs from point p to bear off; pointAt is its inverse.
  const dist = seats.map((seat) => {
    const a = new Int8Array(N + 1);
    for (let p = 1; p <= N; p++) a[p] = seat.dir < 0 ? p : N + 1 - p;
    return a;
  });
  const pointAt = seats.map((seat) => {
    const a = new Int8Array(N + 1);
    for (let r = 1; r <= N; r++) a[r] = seat.dir < 0 ? r : N + 1 - r;
    return a;
  });
  // Points of each seat's track, farthest from bearing off first.
  const scanOrder = pointAt.map((at) => {
    const a = new Int8Array(N);
    for (let r = N; r >= 1; r--) a[N - r] = at[r];
    return a;
  });
  const outside = pointAt.map((at) => {
    const a = [];
    for (let r = homeSize + 1; r <= N; r++) a.push(at[r]);
    return Int8Array.from(a);
  });
  const slotOf = new Int8Array(S);
  turnOrder.forEach((s, i) => { slotOf[s] = i; });
  const mates = seats.map((_, s) => teamSeats[teamOf[s]]
    .filter((m) => m !== s)
    .sort((a, b) => ((slotOf[a] - slotOf[s] + S) % S) - ((slotOf[b] - slotOf[s] + S) % S)));

  const rules = Object.freeze({
    id: variant.id,
    variant,
    N,
    S,
    homeSize,
    checkersPerSeat,
    startSanctuary: variant.startSanctuary === true,
    seatIds,
    seatIndex: new Map(seatIds.map((id, i) => [id, i])),
    teamIds: teams.map((t) => t.id),
    teamOf,
    dir,
    startPoint,
    teamSeats,
    mates,
    dist,
    pointAt,
    scanOrder,
    outside,
    turnOrder: Int8Array.from(turnOrder),
    zobrist: buildZobrist(N, S, checkersPerSeat),
  });
  cache.set(variant, rules);
  return rules;
}
