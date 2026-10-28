import { Game, QUADRANT_PLAKOTO_4P, Position, compileVariant, createRng, enumerateTurns } from '../engine/index.js';

export const rules = compileVariant(QUADRANT_PLAKOTO_4P);
export const T1 = 0;
export const B1 = 1;
export const T2 = 2;
export const B2 = 3;

// Builds a position from {point: 'seat:n[!]+seat:n'} and optional off counts {seat: n}.
export function posIn(ruleSet, points = {}, off = {}) {
  const parts = [];
  for (let p = 1; p <= ruleSet.N; p++) parts.push(points[p] ?? '.');
  const offs = ruleSet.seatIds.map((id) => off[id] ?? 0);
  return Position.fromText(ruleSet, `${parts.join('/')} ${offs.join(',')}`);
}

export function pos(points = {}, off = {}) {
  return posIn(rules, points, off);
}

export function seqKey(steps) {
  return steps.map((st) => `${st.from}:${st.die}`).join(',');
}

// Plays a whole game choosing uniformly among the distinct legal outcomes of every roll.
export function playRandom(seed, { variant = QUADRANT_PLAKOTO_4P, maxTurns = 3000, beforeRoll = null } = {}) {
  const rng = createRng(seed);
  const game = new Game(variant, { firstSlot: rng.int(compileVariant(variant).S) });
  while (!game.over && game.turnNumber < maxTurns) {
    const dice = rng.roll();
    if (beforeRoll) beforeRoll(game, dice, rng);
    const rolled = game.roll(dice);
    if (!rolled.passed) {
      const turns = enumerateTurns(game.position, game.actor, game.dice, { limits: game.limits });
      game.playTurn(turns[rng.int(turns.length)].steps);
    }
  }
  return game;
}
