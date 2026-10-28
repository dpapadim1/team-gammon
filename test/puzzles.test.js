import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Position, createRng, enumerateTurns } from '../engine/index.js';
import { ValueNet } from '../bots/nn.js';
import { rulesFor } from '../client/js/format.js';
import { LESSONS } from '../client/js/lessons.js';
import { TurnBuilder } from '../client/js/turn.js';
import { DIFFICULTIES, PUZZLE_RATING, THEME_HINTS, afterText, blankProgress, describePlay, difficultyOf, expectedScore, isProvisional, parseProgress, pickNext, puzzleKey, puzzleRating, rateAttempt, stepsText, summary, themesOf, verdict, winRate } from '../client/js/puzzles.js';
import { BALANCED, generate, harvest, rebuild, screen, selectPuzzles } from '../tools/lib/puzzles.js';

const rules = rulesFor();
const lesson = (id) => LESSONS.find((l) => l.id === id);
const seatOf = (l) => rules.seatIndex.get(l.seat);
const THEMES = Object.keys(THEME_HINTS);

test('a play that was not played out is estimated below the best play, and only the best play solves a puzzle', () => {
  const puzzle = {
    bias: -0.05,
    plays: [
      { steps: [[1, 1]], win: 0.6, nn: 0.65, n: 600 },
      { steps: [[2, 1]], win: 0.57, nn: 0.6, n: 600 },
      { steps: [[3, 1]], win: 0.52, nn: 0.6, n: 600 },
      { steps: [[4, 1]], win: 0.4, nn: 0.5, n: 600 },
      { steps: [[5, 1]], nn: 0.9 },
      { steps: [[6, 1]], nn: 0.3 },
    ],
  };
  assert.equal(winRate(puzzle, puzzle.plays[0]), 0.6, 'a verified play keeps its measured rate');
  assert.ok(Math.abs(winRate(puzzle, puzzle.plays[4]) - 0.59) < 1e-9, 'an optimistic estimate stays just below the best play');
  assert.ok(Math.abs(winRate(puzzle, puzzle.plays[5]) - 0.25) < 1e-9, 'a guess is the network value shifted by the bias');

  assert.deepEqual(verdict(puzzle, 0), { kind: 'best', loss: 0 });
  assert.deepEqual([1, 2, 3, 4, 5].map((i) => verdict(puzzle, i).kind), ['close', 'mistake', 'blunder', 'close', 'blunder']);
  assert.ok(Math.abs(verdict(puzzle, 1).loss - 0.03) < 1e-9);
  assert.ok(verdict(puzzle, 4).loss >= 0.005, 'a different play always loses something');
});

test('a puzzle is easy when the obvious play is right and clearly so, and hard when the obvious play is a serious mistake', () => {
  assert.equal(difficultyOf({ margin: 0.12, hloss: 0 }), 'easy');
  assert.equal(difficultyOf({ margin: 0.07, hloss: 0 }), 'medium', 'right, but only just better than the next play');
  assert.equal(difficultyOf({ margin: 0.2, hloss: 0.06 }), 'medium', 'the obvious play loses a little');
  assert.equal(difficultyOf({ margin: 0.2, hloss: 0.1 }), 'hard');
  assert.equal(difficultyOf({ margin: 0.05, hloss: 0.3 }), 'hard');
});

test('a puzzle keeps its key when the set is renumbered, and no two puzzles share one', () => {
  const puzzle = { id: 1, seat: 't1', dice: [3, 1], position: 'some position' };
  assert.equal(puzzleKey(puzzle), puzzleKey({ ...puzzle, id: 40, difficulty: 'hard' }));
  assert.notEqual(puzzleKey(puzzle), puzzleKey({ ...puzzle, seat: 't2' }));
  assert.notEqual(puzzleKey(puzzle), puzzleKey({ ...puzzle, dice: [4, 1] }));
  assert.notEqual(puzzleKey(puzzle), puzzleKey({ ...puzzle, position: 'another position' }));
  assert.match(puzzleKey(puzzle), /^[0-9a-z]{1,7}$/);
});

// A puzzle with `options` plays, the best of which wins `margin` more often than the next.
function fake(id, difficulty, margin, options = 10) {
  const plays = Array.from({ length: options }, (_, i) => (i < 2 ? { steps: [[1, i + 1]], win: i === 0 ? 0.5 + margin : 0.5 } : { steps: [[1, i + 1]], nn: 0.2 }));
  return { id, seat: 't1', dice: [1, 2], position: `fake position ${id}`, difficulty, plays };
}

test('a puzzle is rated by its class, by how clear the best play is and by how many plays there are', () => {
  assert.deepEqual(['easy', 'medium', 'hard'].map((d) => puzzleRating(fake(1, d, 0.12))), [1100, 1450, 1800]);
  assert.equal(puzzleRating(fake(1, 'easy', 0.5)), 980, 'a clear-cut best play lowers it by up to 120');
  assert.equal(puzzleRating(fake(1, 'easy', 0.06)), 1160, 'a narrow one raises it');
  assert.equal(puzzleRating(fake(1, 'easy', 0.12, 3)), 1045, 'few plays to choose from lower it');
  assert.equal(puzzleRating(fake(1, 'easy', 0.12, 40)), 1160, 'many raise it by up to 60');
  assert.equal(puzzleRating(fake(1, 'easy', 0.9, 2)), 920);
  assert.equal(puzzleRating(fake(1, 'hard', 0.0, 60)), 1980);
});

test('the expected score follows the Elo curve', () => {
  assert.equal(expectedScore(1200, 1200), 0.5);
  assert.ok(Math.abs(expectedScore(1400, 1000) - 0.9091) < 1e-3);
  assert.ok(Math.abs(expectedScore(1000, 1400) + expectedScore(1400, 1000) - 1) < 1e-12);
});

test('the first attempt at a puzzle moves the rating and later attempts do not', () => {
  const progress = blankProgress();
  const puzzle = fake(1, 'easy', 0.12); // rated 1100, the player starts at 1000
  const first = rateAttempt(progress, puzzle, 1);
  assert.equal(first.before, 1000);
  assert.equal(first.after, Math.round(1000 + PUZZLE_RATING.kProvisional * (1 - expectedScore(1000, 1100))));
  assert.equal(first.delta, first.after - first.before);
  assert.ok(first.delta > 0);
  assert.equal(first.puzzle, 1100);
  assert.deepEqual({ ...progress.results[puzzleKey(puzzle)] }, { n: 1, score: 1, delta: first.delta, solved: false });
  assert.equal(rateAttempt(progress, puzzle, 0), null, 'a second attempt changes nothing');
  assert.equal(Math.round(progress.rating), first.after);

  const miss = rateAttempt(progress, fake(2, 'easy', 0.12), 0);
  assert.ok(miss.delta < 0);
  assert.equal(progress.results[puzzleKey(fake(2, 'easy', 0.12))].n, 2, 'attempts are counted in order');

  const level = blankProgress();
  level.rating = 1100;
  assert.equal(rateAttempt(level, fake(3, 'easy', 0.12), 0.5).delta, 0, 'a hint halves the credit: half a point against an equal puzzle changes nothing');
});

test('the rating settles after the provisional puzzles and never falls below the floor', () => {
  assert.equal(isProvisional(blankProgress()), true);
  const veteran = blankProgress();
  for (let i = 0; i < PUZZLE_RATING.provisional; i++) veteran.results[`k${i}`] = { n: i + 1, score: 1, delta: 0, solved: true };
  veteran.rating = 1100;
  assert.equal(isProvisional(veteran), false);
  assert.equal(rateAttempt(veteran, fake(9, 'easy', 0.12), 1).delta, PUZZLE_RATING.k / 2, 'against an equal puzzle a win is worth half of K');

  const bottom = blankProgress();
  bottom.rating = PUZZLE_RATING.floor;
  assert.equal(rateAttempt(bottom, fake(4, 'easy', 0.12), 0).after, PUZZLE_RATING.floor);
});

test('the next puzzle is the one nearest to the rating that was not attempted yet', () => {
  const set = [fake(1, 'easy', 0.12), fake(2, 'medium', 0.12), fake(3, 'hard', 0.12), fake(4, 'easy', 0.12)]; // 1100, 1450, 1800, 1100
  const progress = blankProgress();
  assert.equal(pickNext(set, progress).id, 1, 'the first of two equally near puzzles');
  progress.rating = 1500;
  assert.equal(pickNext(set, progress).id, 2);
  progress.rating = 3000;
  assert.equal(pickNext(set, progress).id, 3);
  rateAttempt(progress, set[2], 1);
  progress.rating = 3000;
  assert.equal(pickNext(set, progress).id, 2, 'a puzzle that was attempted is not served again while others are left');

  for (const p of set) rateAttempt(progress, p, 0);
  for (const id of [1, 3]) progress.results[puzzleKey(set[id - 1])].solved = true;
  progress.rating = 1400;
  assert.equal(pickNext(set, progress).id, 2, 'when all were attempted, a missed one comes back: the nearest');
  for (const p of set) progress.results[puzzleKey(p)].solved = true;
  assert.equal(pickNext(set, progress), null, 'nothing is left when everything is solved');
});

test('stored progress is read defensively and survives a round trip', () => {
  for (const text of [null, undefined, '', 'nonsense', '[]', '7', '"x"', '{"rating":"high"}']) assert.deepEqual(parseProgress(text), blankProgress(), String(text));

  const parsed = parseProgress('{"rating":1234.5,"results":{"abc12":{"n":3,"score":0.5,"delta":-7.4,"solved":true},"__proto__":{"score":1},"waytoolongkey":{"score":1},"bad":"x","worse":{"score":"x"},"big":{"score":7}}}');
  assert.equal(parsed.rating, 1234.5);
  assert.deepEqual(Object.keys(parsed.results).sort(), ['abc12', 'big']);
  assert.deepEqual({ ...parsed.results.abc12 }, { n: 3, score: 0.5, delta: -7, solved: true });
  assert.equal(parsed.results.big.score, 1, 'scores stay between 0 and 1');
  assert.equal(Object.getPrototypeOf(parsed.results), null, 'a stored name cannot reach into Object.prototype');
  assert.equal(parseProgress('{"rating":99999}').rating, 4000);
  assert.equal(parseProgress('{"rating":-5}').rating, PUZZLE_RATING.floor);

  const progress = blankProgress();
  rateAttempt(progress, fake(1, 'easy', 0.12), 1);
  rateAttempt(progress, fake(2, 'hard', 0.07), 0);
  progress.results[puzzleKey(fake(1, 'easy', 0.12))].solved = true;
  assert.deepEqual(parseProgress(JSON.stringify(progress)), progress);
});

test('a play is described by what it pins, blocks and bears off', () => {
  const describe = (id, wire) => {
    const l = lesson(id);
    return describePlay(l.position(), seatOf(l), wire ?? l.solution);
  };

  const pin = describe('pins');
  assert.deepEqual(pin.steps[0], { from: 17, die: 3, to: 14, pin: true });
  assert.deepEqual(pin.pins, [14]);
  assert.deepEqual(themesOf(pin), ['pin']);
  assert.match(summary(pin), /^Pins an enemy checker on point 14\.$/);
  assert.equal(stepsText(pin), '17\u219214, 24\u219223');
  assert.deepEqual(themesOf(describe('pins', lesson('pins').wrong)), ['position'], 'the same roll without the pin is a quiet play');

  const off = describe('bearoff');
  assert.equal(off.off, 2);
  assert.deepEqual(themesOf(off), ['bearoff']);
  assert.equal(stepsText(off), '6\u2192off, 2\u2192off');
  assert.match(summary(off), /^Bears off 2 checkers\.$/);

  const quiet = describe('move');
  assert.deepEqual(themesOf(quiet), ['position']);
  assert.match(summary(quiet), /^A quiet play/);

  const block = describe('move', [[24, 3], [24, 3]]);
  assert.deepEqual(block.blocks, [21], 'two of the team on an empty point make a block');
  assert.deepEqual(themesOf(block), ['block']);
  assert.match(summary(block), /^Makes a block on point 21\.$/);
});

test('two plays are the same play when they end in the same position', () => {
  const l = lesson('move');
  const position = l.position();
  const seat = seatOf(l);
  assert.equal(afterText(position, seat, [[24, 6], [24, 3]]), afterText(position, seat, [[24, 3], [24, 6]]));
  assert.notEqual(afterText(position, seat, [[24, 6], [24, 3]]), afterText(position, seat, [[24, 6], [18, 3]]));
  assert.equal(position.toText(), l.position().toText(), 'the position itself is not changed');
});

// A tiny search on a random network: it will not find good puzzles, but it exercises every step of the generator.
const net = ValueNet.random([12, 6], createRng(7), 0.4);
const TINY = { minTurn: 4, maxTurn: 24, perGame: 2, minOutcomes: 3, gap: -1, minValue: 0, maxValue: 1, topA: 2, rollsA: 1, passA: -1, topB: 3, rollsB: 2, margin: -1, z: -100 };

test('the generator harvests the same positions for the same game and rebuilds them exactly', () => {
  const states = harvest(net, 11, TINY);
  assert.ok(states.length >= 1 && states.length <= TINY.perGame);
  assert.deepEqual(harvest(net, 11, TINY), states);
  assert.notDeepEqual(harvest(net, 12, TINY), states);
  for (const state of states) {
    const game = rebuild(state);
    assert.equal(game.position.toText(), state.position);
    assert.deepEqual(game.dice, state.dice);
    assert.equal(rules.seatIds[game.actor], state.seat);
    assert.ok(state.turn >= TINY.minTurn && state.turn <= TINY.maxTurn, 'taken from the part of the game that was asked for');
    const screened = screen(net, state, TINY);
    if (screened) {
      assert.equal(screened.turns.length, screened.nn.length);
      assert.ok(screened.nn[screened.order[0]] >= screened.nn[screened.order[1]], 'the plays are ranked by the network');
    }
  }
  assert.equal(screen(net, states[0], { ...TINY, minOutcomes: 1000 }), null, 'a position with too few plays is not a puzzle');
  assert.equal(screen(net, states[0], { ...TINY, minValue: 2 }), null, 'neither is a decided position');
});

test('every puzzle the generator finds lists every legal play once, with the played-out plays first', () => {
  const found = [];
  const stats = generate(net, { seed: 5, games: 2, options: TINY, onPuzzle: (p) => found.push(p) });
  assert.equal(stats.games, 2);
  assert.equal(stats.puzzles, found.length);
  assert.ok(found.length >= 1, 'the settings above accept every position');
  assert.ok(found.every((p) => p.game === 5 || p.game === 6), 'puzzles carry the seed of their game');

  for (const puzzle of found) {
    const game = rebuild(puzzle);
    const position = Position.fromText(rules, puzzle.position);
    const legal = enumerateTurns(game.position, game.actor, game.dice, { limits: game.limits, withPositions: true }).map((t) => t.after.toText());
    const listed = puzzle.plays.map((p) => afterText(position, game.actor, p.steps));
    assert.equal(new Set(listed).size, listed.length, 'no play twice');
    assert.deepEqual([...listed].sort(), [...legal].sort(), 'all legal plays and nothing else');

    const played = puzzle.plays.filter((p) => p.win !== undefined);
    assert.equal(played.length, TINY.topB);
    assert.deepEqual(puzzle.plays.slice(0, played.length), played, 'played-out plays come first');
    for (let i = 1; i < played.length; i++) assert.ok(played[i - 1].win >= played[i].win, 'best first');
    assert.ok(played.every((p) => p.n === TINY.rollsB));
    assert.ok(Number.isFinite(puzzle.hloss) && puzzle.hloss >= 0, 'what the heuristic bot gives away');
    assert.ok(DIFFICULTIES.includes(difficultyOf(puzzle)));
    assert.deepEqual(puzzle.themes, themesOf(describePlay(position, game.actor, puzzle.plays[0].steps)));
  }

  const again = [];
  generate(net, { seed: 5, first: 0, step: 2, games: 1, options: TINY, onPuzzle: (p) => again.push(p) });
  assert.deepEqual(again, found.filter((p) => p.game === 5), 'the same seed finds the same puzzles, however the games are shared out');
});

test('the final selection takes one puzzle per game, mixes difficulties and themes, and numbers them', () => {
  // Games 0, 3, 6, ... are easy, 1, 4, ... medium and 2, 5, ... hard; the themes cycle inside each kind.
  const MEASURES = [{ margin: 0.1, hloss: 0 }, { margin: 0.07, hloss: 0.06 }, { margin: 0.07, hloss: 0.15 }];
  const raw = [];
  for (let g = 0; g < 45; g++) {
    const { margin, hloss } = MEASURES[g % 3];
    raw.push({ game: g, margin: margin + (g % 7) / 1000, hloss, themes: [THEMES[Math.floor(g / 3) % THEMES.length]], plays: [{ win: 0.55 }], marker: `game ${g}` });
  }
  // The first twelve games found a second, clearer puzzle of the same kind; game 3 also found a hard one.
  for (let g = 0; g < 12; g++) raw.push({ ...raw[g], margin: raw[g].margin + 0.05, marker: `twin ${g}` });
  raw.push({ game: 3, margin: 0.9, hloss: 0.2, themes: ['pin'], plays: [{ win: 0.55 }], marker: 'hard twin' });
  // Positions that are nearly won or lost are left out, however clear the best play is.
  raw.push({ game: 100, margin: 0.95, hloss: 0.3, themes: ['pin'], plays: [{ win: 0.93 }], marker: 'nearly won' });
  raw.push({ game: 101, margin: 0.95, hloss: 0.3, themes: ['pin'], plays: [{ win: 0.12 }], marker: 'nearly lost' });
  const gameOf = Object.fromEntries(raw.map((p) => [p.marker, p.game]));

  const picked = selectPuzzles(raw, 20);
  assert.equal(picked.length, 20);
  assert.ok(!picked.some((p) => p.marker === 'nearly won' || p.marker === 'nearly lost'), 'decided positions are no puzzles');
  assert.deepEqual(picked.map((p) => p.id), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.ok(picked.every((p) => !('game' in p) && !('margin' in p) && !('hloss' in p)));
  assert.equal(new Set(picked.map((p) => gameOf[p.marker])).size, 20, 'one puzzle per game');
  assert.ok(picked.every((p) => !/^game (\d|1[01])$/.test(p.marker)), 'a game gives its clearest puzzle, not the first it found');
  assert.ok(picked.some((p) => p.marker === 'hard twin') && !picked.some((p) => gameOf[p.marker] === 3 && p.marker !== 'hard twin'), 'a game lends its hard puzzle before its easy one');

  const counts = Object.fromEntries(DIFFICULTIES.map((d) => [d, picked.filter((p) => p.difficulty === d).length]));
  assert.deepEqual(counts, { easy: 8, medium: 7, hard: 5 });
  for (const d of DIFFICULTIES) {
    const themes = new Set(picked.filter((p) => p.difficulty === d).map((p) => p.themes[0]));
    assert.ok(themes.size >= Math.min(THEMES.length, counts[d]), `${d} puzzles cover the themes`);
  }
  const order = picked.map((p) => DIFFICULTIES.indexOf(p.difficulty));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'easy puzzles come first');

  assert.equal(selectPuzzles(raw, 500).length, 45, 'asking for more than there is returns one puzzle per game');
  const onlyEasy = raw.filter((p) => difficultyOf(p) === 'easy');
  assert.equal(selectPuzzles(onlyEasy, 10).length, 10, 'a missing kind is made up with what there is');
});

const shipped = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../client/puzzles.json', import.meta.url)), 'utf8'));

// Can the player produce this play with the clicks the page offers? Tries every order of the play's steps, since
// moving one checker twice only works in one order.
function clickable(position, seat, dice, play) {
  const target = afterText(position, seat, play.steps);
  const steps = describePlay(position, seat, play.steps).steps;
  const builder = new TurnBuilder(position, seat, dice);
  const search = (rest) => {
    if (rest.length === 0) return builder.done && builder.position.toText() === target;
    for (let i = 0; i < rest.length; i++) {
      const step = builder.stepFor(rest[i].from, rest[i].to);
      if (!step) continue;
      builder.play(step);
      const found = search(rest.filter((_, j) => j !== i));
      builder.undo();
      if (found) return true;
    }
    return false;
  };
  return search(steps);
}

test('the shipped puzzles are valid and each has one clearly better play', () => {
  assert.equal(shipped.version, 1);
  assert.match(shipped.generated, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(shipped.rollouts >= 100);
  assert.ok(shipped.puzzles.length >= 40, 'enough puzzles for a page');
  for (const d of DIFFICULTIES) assert.ok(shipped.puzzles.some((p) => p.difficulty === d), `some ${d} puzzles`);
  assert.equal(new Set(shipped.puzzles.map(puzzleKey)).size, shipped.puzzles.length, 'every puzzle has its own key');

  const positions = new Set();
  shipped.puzzles.forEach((puzzle, i) => {
    const label = `puzzle ${puzzle.id}`;
    assert.equal(puzzle.id, i + 1, 'ids count up from 1');
    assert.ok(DIFFICULTIES.includes(puzzle.difficulty), label);
    assert.ok(puzzle.themes.length >= 1 && puzzle.themes.every((t) => THEMES.includes(t)), label);
    assert.ok(Array.isArray(puzzle.dice) && puzzle.dice.length === 2 && puzzle.dice.every((d) => Number.isInteger(d) && d >= 1 && d <= 6), label);
    const seat = rules.seatIndex.get(puzzle.seat);
    assert.notEqual(seat, undefined, label);
    const position = Position.fromText(rules, puzzle.position);
    assert.equal(position.toText(), puzzle.position, `${label} is written the way the engine writes it`);
    assert.ok(!positions.has(puzzle.position), `${label} is not a duplicate`);
    positions.add(puzzle.position);

    const game = rebuild(puzzle);
    assert.equal(game.actor, seat, label);
    const legal = enumerateTurns(game.position, game.actor, game.dice, { limits: game.limits, withPositions: true }).map((t) => t.after.toText());
    const listed = puzzle.plays.map((p) => afterText(position, seat, p.steps));
    assert.equal(new Set(listed).size, listed.length, `${label}: no play twice`);
    assert.deepEqual([...listed].sort(), [...legal].sort(), `${label}: all legal plays and nothing else`);
    puzzle.plays.forEach((play, k) => assert.ok(clickable(position, seat, puzzle.dice, play), `${label}: play ${k} can be made with clicks on the board`));

    const played = puzzle.plays.filter((p) => p.win !== undefined);
    assert.ok(played.length >= 3, label);
    assert.deepEqual(puzzle.plays.slice(0, played.length), played, `${label}: played-out plays come first`);
    for (let k = 1; k < played.length; k++) assert.ok(played[k - 1].win >= played[k].win, `${label}: best first`);
    assert.ok(played[0].win - played[1].win >= 0.04, `${label}: the best play is clearly better`);
    assert.ok(played[0].win >= BALANCED.min && played[0].win <= BALANCED.max, `${label}: the position is not decided`);
    assert.ok(played.every((p) => p.n === shipped.rollouts), label);
    assert.deepEqual(puzzle.themes, themesOf(describePlay(position, seat, puzzle.plays[0].steps)), `${label}: themes describe the best play`);
  });
});

test('the shipped puzzles cover a wide range of ratings and are served one by one, nearest first', () => {
  const rated = shipped.puzzles.map((p) => ({ difficulty: p.difficulty, rating: puzzleRating(p) }));
  assert.ok(rated.every(({ rating }) => rating >= 800 && rating <= 2000));
  const mean = (d) => {
    const ratings = rated.filter((x) => x.difficulty === d).map((x) => x.rating);
    return ratings.reduce((a, b) => a + b, 0) / ratings.length;
  };
  assert.ok(mean('easy') < mean('medium') && mean('medium') < mean('hard'), 'harder classes are rated higher');
  assert.ok(Math.max(...rated.map((x) => x.rating)) - Math.min(...rated.map((x) => x.rating)) >= 600, 'enough room to climb');

  const progress = blankProgress();
  const first = pickNext(shipped.puzzles, progress);
  assert.equal(Math.abs(puzzleRating(first) - PUZZLE_RATING.start), Math.min(...rated.map((x) => Math.abs(x.rating - PUZZLE_RATING.start))), 'a new player starts near the start rating');

  const served = new Set();
  for (let next = first; next !== null; next = pickNext(shipped.puzzles, progress)) {
    assert.ok(!served.has(next.id), `puzzle ${next.id} is served once`);
    served.add(next.id);
    rateAttempt(progress, next, 1);
    progress.results[puzzleKey(next)].solved = true;
  }
  assert.equal(served.size, shipped.puzzles.length, 'a player who solves everything meets every puzzle');
  assert.ok(progress.rating > PUZZLE_RATING.start + 300, 'and ends well above the start');
});
