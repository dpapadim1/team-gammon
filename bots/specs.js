import { createBotForLevel } from './levels.js';
import { createHeuristicBot } from './heuristic.js';
import { createNetBot, loadNetFile } from './nn.js';
import { createRandomBot } from './random.js';

// Bot descriptions for tools and tests: "random", "heuristic", "level:7", "net:path/to/net.json" with optional
// options after a question mark: eps, tau, plies (1 or 2) and cand, e.g. "net:models/champion.json?plies=2&cand=5".
export function createBotFromSpec(spec, rng) {
  if (spec === 'random') return createRandomBot(rng);
  if (spec === 'heuristic') return createHeuristicBot(rng);
  if (spec.startsWith('level:')) return createBotForLevel(Number(spec.slice(6)), rng);
  if (spec.startsWith('net:')) {
    const rest = spec.slice(4);
    const q = rest.lastIndexOf('?');
    const file = q < 0 ? rest : rest.slice(0, q);
    const options = new URLSearchParams(q < 0 ? '' : rest.slice(q + 1));
    return createNetBot(loadNetFile(file), rng, {
      epsilon: Number(options.get('eps') ?? 0),
      tau: Number(options.get('tau') ?? 0),
      plies: Number(options.get('plies') ?? 1),
      candidates: Number(options.get('cand') ?? 5),
      name: spec,
    });
  }
  throw new Error(`unknown bot "${spec}"; use random, heuristic, level:N or net:<file>`);
}
