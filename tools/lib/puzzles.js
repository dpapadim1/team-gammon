import { Game, Position, QUADRANT_PLAKOTO_4P, compileVariant, createRng, enumerateTurns, reverseCycle } from '../../engine/index.js';
import { createHeuristicBot } from '../../bots/heuristic.js';
import { createFeatureBuffer } from '../../bots/features.js';
import { afterValue, createNetBot } from '../../bots/nn.js';
import { DIFFICULTIES, describePlay, difficultyOf, themesOf, winRate } from '../../client/js/puzzles.js';

// A puzzle is a real position with one clearly best play. Positions come from self-play of the network; the network
// ranks the legal plays, and the best few are played out by the network against itself to see which one really wins.
export const DEFAULTS = Object.freeze({
  minTurn: 8,
  maxTurn: 80,
  perGame: 3,
  epsilon: 0.05, // chance of a random turn in the game the positions are taken from
  minOutcomes: 6,
  maxOutcomes: 70,
  gap: 0.02, // best minus second best by the network before any game is played out
  minValue: 0.25, // positions that are already decided make poor puzzles: the best play must keep the team's chances
  maxValue: 0.85, // between these two bounds, as the network sees them
  topA: 3,
  rollsA: 150,
  passA: 0.03, // the first, cheap round must already show this much difference
  topB: 4,
  rollsB: 600,
  margin: 0.04, // the best play has to win this much more often than the second best
  z: 2,
});

const variantFor = (reversed) => (reversed ? reverseCycle(QUADRANT_PLAKOTO_4P) : QUADRANT_PLAKOTO_4P);
const mix = (a, b) => (Math.imul((a ^ 0x9e3779b9) >>> 0, 0x85ebca6b) ^ Math.imul((b + 0x7f4a7c15) >>> 0, 0xc2b2ae35)) >>> 0;
const wireOf = (steps) => steps.map((s) => [s.from, s.die]);
const round = (x, digits = 3) => Math.round(x * 10 ** digits) / 10 ** digits;

// A position to solve: the state right after the dice were rolled.
function stateOf(game, reversed) {
  return { reversed, slot: game.slot, dice: game.dice.slice(), position: game.position.toText(), turn: game.turnNumber, seat: game.rules.seatIds[game.actor] };
}

export function rebuild(state) {
  const variant = variantFor(state.reversed);
  const rules = compileVariant(variant);
  const game = new Game(variant, { firstSlot: state.slot, position: Position.fromText(rules, state.position) });
  game.roll(state.dice);
  return game;
}

// Plays one game and returns a few of its positions, taken right after the dice were rolled.
export function harvest(net, gameSeed, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const rng = createRng(gameSeed);
  const reversed = rng.int(2) === 1;
  const variant = variantFor(reversed);
  const game = new Game(variant, { firstSlot: rng.int(compileVariant(variant).S) });
  const bot = createNetBot(net, createRng(mix(gameSeed, 1)), { epsilon: o.epsilon });
  const picks = new Set();
  while (picks.size < o.perGame) picks.add(o.minTurn + rng.int(o.maxTurn - o.minTurn + 1));
  const states = [];
  while (!game.over && game.turnNumber < 400) {
    const rolled = game.roll(rng.roll());
    if (rolled.passed) continue;
    if (picks.has(game.turnNumber) && game.actor === game.slotSeat) states.push(stateOf(game, reversed));
    game.playTurn(bot.chooseTurn(game));
  }
  return states;
}

// All legal plays of a state with the network's value for each, or null when the position is not worth a puzzle.
export function screen(net, state, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const game = rebuild(state);
  const rules = game.rules;
  const team = rules.teamOf[game.actor];
  const nextSlot = (game.slot + 1) % rules.S;
  const feat = createFeatureBuffer();
  const turns = enumerateTurns(game.position, game.actor, game.dice, { limits: game.limits, withPositions: true });
  if (turns.length < o.minOutcomes || turns.length > o.maxOutcomes) return null;
  const nn = turns.map((turn) => afterValue(net, turn.after, team, nextSlot, feat));
  const order = nn.map((_, i) => i).sort((a, b) => nn[b] - nn[a]);
  if (nn[order[0]] - nn[order[1]] < o.gap) return null;
  if (nn[order[0]] < o.minValue || nn[order[0]] > o.maxValue) return null;
  return { game, turns, nn, order, team };
}

// The mover's team plays `steps`, then every seat plays the network's best turn until the game ends: 1, 0.5 or 0.
function playout(base, steps, team, net, seed) {
  const game = base.clone();
  game.playTurn(steps);
  const rng = createRng(seed);
  const bot = createNetBot(net, createRng(mix(seed, 2)));
  const limit = game.turnNumber + 400;
  while (!game.over && game.turnNumber < limit) {
    const rolled = game.roll(rng.roll());
    if (rolled.passed) continue;
    game.playTurn(bot.chooseTurn(game));
  }
  return !game.over || game.winnerTeam === -1 ? 0.5 : game.winnerTeam === team ? 1 : 0;
}

// Plays the best plays out in two rounds and returns the puzzle, or null when no play is clearly better than the others.
// Play number i of every candidate uses the same dice (seed + i), so the plays are compared on equal terms.
export function solve(net, state, seed, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const screened = screen(net, state, o);
  if (!screened) return null;
  const { game, turns, nn, order, team } = screened;
  const tally = new Map();
  const extend = (index, upTo) => {
    const t = tally.get(index) ?? { sum: 0, n: 0 };
    for (; t.n < upTo; t.n++) t.sum += playout(game, turns[index].steps, team, net, mix(seed, t.n));
    tally.set(index, t);
  };
  const rank = (indexes) => [...indexes].sort((a, b) => tally.get(b).sum / tally.get(b).n - tally.get(a).sum / tally.get(a).n);
  const rate = (index) => tally.get(index).sum / tally.get(index).n;

  for (const index of order.slice(0, o.topA)) extend(index, o.rollsA);
  const first = rank(order.slice(0, o.topA));
  if (rate(first[0]) - rate(first[1]) < o.passA) return null;

  for (const index of order.slice(0, o.topB)) extend(index, o.rollsB);
  const ranked = rank(order.slice(0, o.topB));
  const [w1, w2] = [rate(ranked[0]), rate(ranked[1])];
  const n = tally.get(ranked[0]).n;
  const se = Math.sqrt((w1 * (1 - w1) + w2 * (1 - w2)) / n) || 1e-9;
  if (w1 - w2 < o.margin || (w1 - w2) / se < o.z) return null;

  const rest = order.filter((i) => !ranked.includes(i));
  const bias = ranked.reduce((sum, i) => sum + rate(i) - nn[i], 0) / ranked.length;
  const plays = [
    ...ranked.map((i) => ({ steps: wireOf(turns[i].steps), win: round(rate(i)), nn: round(nn[i]), n: tally.get(i).n })),
    ...rest.map((i) => ({ steps: wireOf(turns[i].steps), nn: round(nn[i]) })),
  ];
  const turnOrder = [...ranked, ...rest];
  const rules = game.rules;
  const seat = rules.seatIds[game.actor];
  const puzzle = { seat, dice: state.dice, reversed: state.reversed, slot: state.slot, turn: state.turn, position: state.position, bias: round(bias), plays };

  // What the heuristic bot, which plays like a careful newcomer, gives away here: the difficulty is decided from it later.
  const heuristic = createHeuristicBot(createRng(mix(seed, 3))).chooseTurn(game);
  const after = game.position.clone();
  for (const step of heuristic) after.applyStep(game.actor, step.from, step.die, step.to);
  const picked = turnOrder.findIndex((i) => turns[i].after.sameAs(after));
  const hloss = picked === 0 ? 0 : round(winRate(puzzle, plays[0]) - winRate(puzzle, plays[picked]));

  const themes = themesOf(describePlay(Position.fromText(rules, state.position), game.actor, plays[0].steps));
  return { ...puzzle, themes, margin: round(w1 - w2), hloss };
}

// Harvests the games first, first + step, ... and solves what they offer. Calls onPuzzle with every puzzle found; `game`
// in it is the seed of the game, which is unique across runs that use different seeds.
export function generate(net, { seed = 1, first = 0, step = 1, games, options = {}, onPuzzle = () => {}, onGame = () => {} }) {
  const stats = { games: 0, states: 0, screened: 0, puzzles: 0 };
  for (let k = 0; k < games; k++) {
    const g = first + k * step;
    const gameSeed = seed + g;
    const states = harvest(net, gameSeed, options);
    stats.games++;
    states.forEach((state, j) => {
      stats.states++;
      if (!screen(net, state, options)) return;
      stats.screened++;
      const puzzle = solve(net, state, mix(gameSeed, j + 10), options);
      if (!puzzle) return;
      stats.puzzles++;
      onPuzzle({ ...puzzle, game: gameSeed });
    });
    onGame(g, stats);
  }
  return stats;
}

// A game that is nearly won or lost is no puzzle, whatever the network thought when it picked the position. This is
// checked against the measured win rate of the best play.
export const BALANCED = Object.freeze({ min: 0.2, max: 0.9 });

// Picks the final set: one puzzle per game, a mix of difficulties and of themes, the clearest ones first. The scarcer
// difficulties choose first, so a game that offers a hard puzzle and an easy one lends the hard one.
export function selectPuzzles(raw, count = 60) {
  const pool = raw
    .filter((p) => p.plays[0].win >= BALANCED.min && p.plays[0].win <= BALANCED.max)
    .map((p) => ({ ...p, difficulty: difficultyOf(p) }))
    .sort((a, b) => b.margin - a.margin || a.game - b.game);
  const quota = { easy: Math.round(count * 0.4), medium: Math.round(count * 0.35) };
  quota.hard = count - quota.easy - quota.medium;
  const games = new Set();
  const chosen = [];
  // Takes up to n puzzles, the clearest of each theme in turn, from games that have not lent a puzzle yet.
  const take = (items, n) => {
    const groups = new Map();
    for (const p of items) {
      if (!groups.has(p.themes[0])) groups.set(p.themes[0], []);
      groups.get(p.themes[0]).push(p);
    }
    let taken = 0;
    for (let progress = true; progress;) {
      progress = false;
      for (const group of groups.values()) {
        while (group.length > 0 && games.has(group[0].game)) group.shift();
        if (taken >= n || group.length === 0) continue;
        const p = group.shift();
        games.add(p.game);
        chosen.push(p);
        taken++;
        progress = true;
      }
    }
  };
  for (const d of ['hard', 'medium', 'easy']) take(pool.filter((p) => p.difficulty === d), quota[d]);
  take(pool.filter((p) => !chosen.includes(p)), count - chosen.length);
  return chosen
    .sort((a, b) => DIFFICULTIES.indexOf(a.difficulty) - DIFFICULTIES.indexOf(b.difficulty) || b.margin - a.margin || a.game - b.game)
    .map(({ game, margin, hloss, ...rest }, i) => ({ id: i + 1, ...rest }));
}
