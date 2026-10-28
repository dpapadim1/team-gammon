import { QUADRANT_PLAKOTO_4P, compileVariant, createRng } from '../../engine/index.js';
import { playGame } from '../../bots/arena.js';
import { createBotFromSpec } from '../../bots/specs.js';

// Games first, first + step, ... between bot A and bot B. A plays the Top team in even games and the Bottom team in odd
// games, so the cycle direction and first mover (drawn from the game seed) balance out.
export function playMatch({ a, b, seed = 1, first = 0, step = 1, count, variant = QUADRANT_PLAKOTO_4P }) {
  const teamOf = compileVariant(variant).teamOf;
  const result = { games: 0, aWins: 0, bWins: 0, draws: 0, turns: 0, unfinished: 0 };
  for (let k = 0; k < count; k++) {
    const g = first + k * step;
    const gameSeed = seed + g;
    const botA = createBotFromSpec(a, createRng(Math.imul(gameSeed, 2654435761) ^ 0x1b873593));
    const botB = createBotFromSpec(b, createRng(Math.imul(gameSeed, 2246822519) ^ 0xcc9e2d51));
    const aTeam = g % 2;
    const { game } = playGame({ variant, botFor: (seat) => (teamOf[seat] === aTeam ? botA : botB), seed: gameSeed });
    if (!game.over) {
      result.unfinished++;
      continue;
    }
    result.games++;
    result.turns += game.history.length;
    if (game.winnerTeam === -1) result.draws++;
    else if (game.winnerTeam === aTeam) result.aWins++;
    else result.bWins++;
  }
  return result;
}

export function mergeMatches(list) {
  const total = { games: 0, aWins: 0, bWins: 0, draws: 0, turns: 0, unfinished: 0 };
  for (const r of list) for (const key of Object.keys(total)) total[key] += r[key];
  return total;
}

// Win rate of A (a draw counts half) with a 95% Wilson interval.
export function summarizeMatch(r) {
  const n = r.games;
  const p = n ? (r.aWins + r.draws / 2) / n : 0.5;
  const z = 1.96;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return {
    games: n,
    aWins: r.aWins,
    bWins: r.bWins,
    draws: r.draws,
    unfinished: r.unfinished,
    aWinRate: p,
    low: n ? centre - half : 0,
    high: n ? centre + half : 1,
    avgTurns: n ? r.turns / n : 0,
  };
}
