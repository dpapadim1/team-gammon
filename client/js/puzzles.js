import { OFF } from '../../engine/index.js';

// Pure helpers for the puzzles, shared by the puzzle page, the generator in tools/ and the tests. No DOM in here.
// A puzzle lists every legal play, best first. The first plays were played out by the neural-network bot ("win" is the share
// of those games the mover's team won); the rest only have the network's value ("nn").

// A short stable name for a puzzle: the page remembers what a player did with a puzzle by it, so progress survives when the set is
// regenerated and the puzzles are numbered afresh. (FNV-1a of the position, the dice and the seat.)
export function puzzleKey(puzzle) {
  let hash = 0x811c9dc5;
  for (const ch of `${puzzle.position} ${puzzle.dice.join(',')} ${puzzle.seat}`) hash = Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return hash.toString(36);
}

// Win probability of a play. Plays that were not played out use the network's value, shifted by the puzzle's bias and
// kept below the best play, which was verified.
export function winRate(puzzle, play) {
  if (play.win !== undefined) return play.win;
  const guess = Math.min(1, Math.max(0, play.nn + puzzle.bias));
  return Math.min(guess, puzzle.plays[0].win - 0.01);
}

// How much worse a play is than the best one. Only the best play solves a puzzle.
export function verdict(puzzle, index) {
  if (index === 0) return { kind: 'best', loss: 0 };
  const loss = Math.max(0.005, winRate(puzzle, puzzle.plays[0]) - winRate(puzzle, puzzle.plays[index]));
  return { kind: loss < 0.05 ? 'close' : loss < 0.1 ? 'mistake' : 'blunder', loss };
}

// The position after a play, as text: two plays with the same text are the same play. `wire` is [[from, die], ...].
export function afterText(position, seat, wire) {
  const work = position.clone();
  for (const [from, die] of wire) work.applyStep(seat, from, die);
  return work.toText();
}

// What a play does for the mover: the steps with their targets, new pins, new blocks and checkers borne off.
export function describePlay(position, seat, wire) {
  const rules = position.rules;
  const team = rules.teamOf[seat];
  const work = position.clone();
  const steps = [];
  for (const [from, die] of wire) {
    const rec = work.applyStep(seat, from, die);
    steps.push({ from, die, to: rec.to, pin: rec.to !== OFF && rec.pinTo < 0 && work.pinned[rec.to] >= 0 });
  }
  const blocks = [];
  for (let p = 1; p <= rules.N; p++) {
    const foes = work.teamCountAt(p, 1 - team);
    if (foes === 0 && work.teamCountAt(p, team) >= 2 && position.teamCountAt(p, team) < 2) blocks.push(p);
  }
  return { steps, pins: steps.filter((s) => s.pin).map((s) => s.to), blocks, off: work.off[seat] - position.off[seat] };
}

export function themesOf(description) {
  const themes = [];
  if (description.pins.length > 0) themes.push('pin');
  if (description.blocks.length > 0) themes.push('block');
  if (description.off > 0) themes.push('bearoff');
  return themes.length > 0 ? themes : ['position'];
}

const list = (points) => (points.length === 1 ? `point ${points[0]}` : `points ${points.slice(0, -1).join(', ')} and ${points.at(-1)}`);

// One sentence on what the play achieves.
export function summary(description) {
  const parts = [];
  if (description.pins.length > 0) parts.push(`pins an enemy checker on ${list(description.pins)}`);
  if (description.blocks.length > 0) parts.push(`makes a block on ${list(description.blocks)}`);
  if (description.off > 0) parts.push(`bears off ${description.off} checker${description.off === 1 ? '' : 's'}`);
  if (parts.length === 0) return 'A quiet play: no pin, no new block and nothing borne off.';
  return `${parts.join(' and ')}.`.replace(/^./, (c) => c.toUpperCase());
}

export function stepsText(description) {
  return description.steps.map((s) => `${s.from}\u2192${s.to === OFF ? 'off' : s.to}`).join(', ');
}

export const THEME_HINTS = Object.freeze({
  pin: 'Look for a chance to pin an enemy checker.',
  block: 'Think about building a point the enemy cannot land on.',
  bearoff: 'Bearing checkers off safely matters here.',
  position: 'No pin or block decides this one: think about safety and where your checkers will stand next.',
});

export const DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard']);

// How hard a puzzle is, from two measurements made when it was found: `margin`, how much more often the best play wins
// than the second best, and `hloss`, how much win rate the heuristic bot gives away with the play it picks (0 when it
// finds the best play). Easy: the obvious play is right, and clearly so. Hard: the obvious play is a serious mistake.
export const DIFFICULTY_RULES = Object.freeze({ easyMargin: 0.08, hardLoss: 0.1 });

export function difficultyOf({ margin, hloss }) {
  if (hloss >= DIFFICULTY_RULES.hardLoss) return 'hard';
  return hloss === 0 && margin >= DIFFICULTY_RULES.easyMargin ? 'easy' : 'medium';
}

// --- the puzzle rating ---------------------------------------------------------------------------------------------
// A rating of its own for solving puzzles, apart from the rating of games. The puzzles have fixed ratings estimated from
// what was measured when they were found, and a player's rating moves once per puzzle, on the first attempt.
export const PUZZLE_RATING = Object.freeze({ start: 1000, floor: 400, provisional: 20, kProvisional: 48, k: 24 });

const CLASS_RATING = Object.freeze({ easy: 1100, medium: 1450, hard: 1800 });
const clamp = (x, low, high) => Math.min(high, Math.max(low, x));

// The rating of the difficulty class, raised when the best play is only just better than the next one and when there
// are many plays to choose from, lowered when it is clear-cut. At most 180 points either way.
export function puzzleRating(puzzle) {
  const margin = puzzle.plays[0].win - puzzle.plays[1].win;
  const adjust = clamp((0.12 - margin) * 1000, -120, 120) + clamp((puzzle.plays.length - 10) * 8, -60, 60);
  return Math.round((CLASS_RATING[puzzle.difficulty] + adjust) / 5) * 5;
}

export const expectedScore = (rating, opponent) => 1 / (1 + 10 ** ((opponent - rating) / 400));

// What the browser remembers: the rating and, per puzzle key, the first attempt (`n` counts them, `score` is 1, 0.5 after
// a hint or 0, `delta` the rating change) and whether the puzzle was solved since without looking at the answer.
export const blankProgress = () => ({ rating: PUZZLE_RATING.start, results: Object.create(null) });

export const isProvisional = (progress) => Object.keys(progress.results).length < PUZZLE_RATING.provisional;

// Keys are plain base-36 words, which also keeps odd names such as __proto__ out of the results.
const KEY = /^[0-9a-z]{1,7}$/;

export function parseProgress(text) {
  const progress = blankProgress();
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return progress;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return progress;
  if (Number.isFinite(raw.rating)) progress.rating = clamp(raw.rating, PUZZLE_RATING.floor, 4000);
  for (const [key, r] of Object.entries(raw.results !== null && typeof raw.results === 'object' ? raw.results : {})) {
    if (!KEY.test(key) || r === null || typeof r !== 'object' || !Number.isFinite(r.score)) continue;
    progress.results[key] = { n: Number.isInteger(r.n) && r.n > 0 ? r.n : 0, score: clamp(r.score, 0, 1), delta: Number.isFinite(r.delta) ? Math.round(r.delta) : 0, solved: r.solved === true };
  }
  return progress;
}

// Records the first attempt at a puzzle and moves the rating: `score` is 1 for the best play, 0.5 for the best play after a
// hint and 0 for anything else. Returns what changed, or null when the puzzle had been attempted before.
export function rateAttempt(progress, puzzle, score) {
  const key = puzzleKey(puzzle);
  if (progress.results[key]) return null;
  const rated = Object.keys(progress.results).length;
  const k = rated < PUZZLE_RATING.provisional ? PUZZLE_RATING.kProvisional : PUZZLE_RATING.k;
  const opponent = puzzleRating(puzzle);
  const before = Math.round(progress.rating);
  progress.rating = Math.max(PUZZLE_RATING.floor, progress.rating + k * (score - expectedScore(progress.rating, opponent)));
  const after = Math.round(progress.rating);
  progress.results[key] = { n: rated + 1, score, delta: after - before, solved: false };
  return { before, after, delta: after - before, puzzle: opponent };
}

// The puzzle to serve next: of those not attempted yet the one rated closest to the player (the first among equals); when
// every puzzle was attempted, the same among those still unsolved; null when all are solved.
export function pickNext(puzzles, progress) {
  const fresh = puzzles.filter((p) => !progress.results[puzzleKey(p)]);
  const pool = fresh.length > 0 ? fresh : puzzles.filter((p) => !progress.results[puzzleKey(p)].solved);
  let best = null;
  for (const p of pool) if (best === null || Math.abs(puzzleRating(p) - progress.rating) < Math.abs(puzzleRating(best) - progress.rating)) best = p;
  return best;
}
