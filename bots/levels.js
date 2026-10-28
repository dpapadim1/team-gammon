import { createRandomBot } from './random.js';
import { createHeuristicBot } from './heuristic.js';
import { loadChampion } from './champion.js';
import { createNetBot } from './nn.js';

// Levels 1-7 mix the heuristic bot with random turns. Levels 8 and 9 play the published value network
// (models/champion.json): level 8 with a chance of a random turn, level 9 looking two plies ahead at its best five
// turns. Without a network they play like level 7.
export const BOT_LEVELS = Object.freeze({
  1: { label: 'Beginner', randomPct: 100 },
  2: { label: 'Novice', randomPct: 70 },
  3: { label: 'Easy', randomPct: 50 },
  4: { label: 'Casual', randomPct: 30 },
  5: { label: 'Intermediate', randomPct: 15 },
  6: { label: 'Strong', randomPct: 6 },
  7: { label: 'Expert', randomPct: 0 },
  8: { label: 'Master', randomPct: 0, net: { epsilon: 0.08 } },
  9: { label: 'Maximum', randomPct: 0, net: { epsilon: 0, plies: 2, candidates: 5 } },
});

export function createBotForLevel(level, rng, { champion = loadChampion() } = {}) {
  const cfg = BOT_LEVELS[level];
  if (!cfg) throw new RangeError(`unknown bot level ${level}`);
  const name = `${cfg.label} bot`;
  if (cfg.net && champion) {
    const bot = createNetBot(champion, rng, cfg.net);
    return { name, level, chooseTurn: (game) => bot.chooseTurn(game) };
  }
  // A weaker bot plays a random legal turn with probability randomPct, otherwise the best heuristic turn.
  const random = createRandomBot(rng);
  const heuristic = createHeuristicBot(rng);
  return {
    name,
    level,
    chooseTurn(game) {
      if (cfg.randomPct > 0 && rng.int(100) < cfg.randomPct) return random.chooseTurn(game);
      return heuristic.chooseTurn(game);
    },
  };
}
