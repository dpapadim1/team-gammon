// Variant explorer: node tools/explore.mjs [--games 300] [--seed 1]
// Compares start layouts and checker counts under heuristic play, then sanity-checks the heuristic against random play.
import { parseArgs } from 'node:util';
import { QUADRANT_PLAKOTO_4P, VARIANTS, withCheckersPerSeat } from '../engine/index.js';
import { createHeuristicBot } from '../bots/heuristic.js';
import { createRandomBot } from '../bots/random.js';
import { formatSummary, runBatch, summarize } from '../bots/stats.js';

const { values } = parseArgs({
  options: {
    games: { type: 'string', default: '300' },
    seed: { type: 'string', default: '1' },
  },
});
const games = Number(values.games);
const seed = Number(values.seed);

const allSeats = (make) => (rng, rules) => Array.from({ length: rules.S }, () => make(rng));
const byTeam = (top, bottom) => (rng, rules) => Array.from({ length: rules.S }, (_, s) => (rules.teamOf[s] === 0 ? top : bottom)(rng));

function show(title, options) {
  const result = runBatch({ games, seed, ...options });
  console.log(`\n${title}\n${formatSummary(summarize(result))}`);
  if (result.deadShapes.size) console.log('  deadlock shapes:', [...result.deadShapes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4));
  return result;
}

console.log('== Heuristic vs heuristic: start layouts ==');
for (const variant of Object.values(VARIANTS)) show(variant.name, { variant, makeBots: allSeats(createHeuristicBot) });

console.log('\n== Heuristic vs heuristic: checkers per seat (quadrant layout) ==');
for (const n of [4, 6, 8]) {
  show(`quadrant layout, ${n} checkers per seat`, { variant: withCheckersPerSeat(QUADRANT_PLAKOTO_4P, n), makeBots: allSeats(createHeuristicBot) });
}

console.log('\n== Heuristic strength check (quadrant layout) ==');
show('Top heuristic vs Bottom random', { variant: QUADRANT_PLAKOTO_4P, makeBots: byTeam(createHeuristicBot, createRandomBot) });
show('Top random vs Bottom heuristic', { variant: QUADRANT_PLAKOTO_4P, makeBots: byTeam(createRandomBot, createHeuristicBot) });
