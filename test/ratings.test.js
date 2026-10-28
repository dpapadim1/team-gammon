import test from 'node:test';
import assert from 'node:assert/strict';
import { BOT_LEVELS } from '../bots/levels.js';
import { BOT_RATINGS, MIN_RATED_TURNS, PROVISIONAL_GAMES, START_RATING, expectedScore, isRated, kFactor, rateGame } from '../server/ratings.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);

// The four seats in table order; `humans` lists the indexes of registered players.
function four({ top = [1200, 1200], bottom = [1200, 1200], humans = [0, 1, 2, 3], games = 0 } = {}) {
  const seats = ['t1', 'b1', 't2', 'b2'];
  const ratings = [top[0], bottom[0], top[1], bottom[1]];
  return seats.map((seat, i) => ({ seat, team: seat[0] === 't' ? 0 : 1, rating: ratings[i], ...(humans.includes(i) ? { userId: 10 + i, games } : {}) }));
}

test('every bot level has an increasing rating that reproduces the measured arena win rates', () => {
  const levels = Object.keys(BOT_LEVELS).map(Number);
  assert.deepEqual(Object.keys(BOT_RATINGS).map(Number), levels);
  // Win rate of each level against the one below it, from tools/arena.mjs.
  const measured = [0.700, 0.678, 0.720, 0.679, 0.639, 0.595, 0.585, 0.685];
  levels.slice(1).forEach((level, i) => {
    assert.ok(BOT_RATINGS[level] > BOT_RATINGS[level - 1], `level ${level} is above ${level - 1}`);
    assert.ok(Math.abs(expectedScore(BOT_RATINGS[level], BOT_RATINGS[level - 1]) - measured[i]) < 0.01, `level ${level}`);
  });
});

test('expected score follows the Elo curve', () => {
  close(expectedScore(1200, 1200), 0.5);
  close(expectedScore(1500, 1300) + expectedScore(1300, 1500), 1);
  assert.ok(Math.abs(expectedScore(1600, 1200) - 0.909) < 0.001);
});

test('K shrinks as a player settles', () => {
  assert.equal(kFactor(0, START_RATING), 40);
  assert.equal(kFactor(PROVISIONAL_GAMES - 1, 2300), 40);
  assert.equal(kFactor(PROVISIONAL_GAMES, 1200), 24);
  assert.equal(kFactor(PROVISIONAL_GAMES, 1799), 24);
  assert.equal(kFactor(PROVISIONAL_GAMES, 1800), 16);
});

test('only finished and long enough games are rated', () => {
  for (const reason of ['bearoff', 'timeout', 'resign', 'deadlock']) {
    assert.equal(isRated(reason, MIN_RATED_TURNS), true, reason);
    assert.equal(isRated(reason, MIN_RATED_TURNS - 1), false, `${reason} too short`);
  }
  for (const reason of ['abandoned', 'error']) assert.equal(isRated(reason, 90), false, reason);
});

test('an even game between four new players moves 20 points each way and is zero-sum', () => {
  const changes = rateGame(four(), 0);
  assert.equal(changes.length, 4);
  for (const c of changes) close(Math.abs(c.after - c.before), 20);
  close(changes.reduce((sum, c) => sum + (c.after - c.before), 0), 0);
  assert.deepEqual(changes.filter((c) => c.won).map((c) => c.seat).sort(), ['t1', 't2']);
});

test('teams are compared by the mean of their seats', () => {
  // 1600 and 800 average 1200, the same as the bottom team.
  for (const c of rateGame(four({ top: [1600, 800], bottom: [1200, 1200] }), 1)) close(Math.abs(c.after - c.before), 20);
});

test('a favourite gains little and loses a lot', () => {
  const lopsided = four({ top: [1700, 1700], bottom: [900, 900], games: 30 });
  const win = rateGame(lopsided, 0)[0];
  const loss = rateGame(lopsided, 1)[0];
  assert.ok(win.after - win.before < 1);
  assert.ok(loss.before - loss.after > 20);
});

test('a draw is half a point, and bots and guests are not updated', () => {
  const entries = four({ humans: [0] });
  const changes = rateGame(entries, -1);
  assert.equal(changes.length, 1);
  close(changes[0].after, changes[0].before);
  assert.equal(changes[0].won, false);
  const underdog = rateGame(four({ top: [1000, 1000], bottom: [1400, 1400], humans: [0] }), -1)[0];
  assert.ok(underdog.after > underdog.before, 'the weaker team gains from a draw');
});

test('each player moves by their own K', () => {
  const entries = four();
  entries[0].games = 100;
  const delta = Object.fromEntries(rateGame(entries, 0).map((c) => [c.seat, c.after - c.before]));
  close(delta.t1, 12);
  close(delta.t2, 20);
});
