// Usage: node tools/sim.mjs [--games 300] [--seed 1] [--variant quadrant-plakoto-4p] [--checkers 8] [--cycle random|forward|reverse] [--order 0,1,2,3] [--top heuristic] [--bottom random]
import { parseArgs } from 'node:util';
import { VARIANTS, withCheckersPerSeat } from '../engine/index.js';
import { createHeuristicBot } from '../bots/heuristic.js';
import { createRandomBot } from '../bots/random.js';
import { formatSummary, runBatch, summarize } from '../bots/stats.js';

const BOTS = { random: createRandomBot, heuristic: createHeuristicBot };

const { values } = parseArgs({
  options: {
    games: { type: 'string', default: '300' },
    seed: { type: 'string', default: '1' },
    variant: { type: 'string', default: 'quadrant-plakoto-4p' },
    checkers: { type: 'string', default: '' },
    cycle: { type: 'string', default: 'random' },
    order: { type: 'string', default: '' },
    top: { type: 'string', default: 'random' },
    bottom: { type: 'string', default: 'random' },
  },
});
if (!VARIANTS[values.variant]) throw new Error(`unknown variant ${values.variant}; choose from ${Object.keys(VARIANTS).join(', ')}`);
for (const kind of [values.top, values.bottom]) if (!BOTS[kind]) throw new Error(`unknown bot ${kind}; choose from ${Object.keys(BOTS).join(', ')}`);

let variant = VARIANTS[values.variant];
if (values.checkers) variant = withCheckersPerSeat(variant, Number(values.checkers));
if (values.order) variant = Object.freeze({ ...variant, turnOrder: values.order.split(',').map(Number) });

const result = runBatch({
  variant,
  games: Number(values.games),
  seed: Number(values.seed),
  cycle: values.cycle,
  makeBots: (rng, rules) => Array.from({ length: rules.S }, (_, seat) => BOTS[rules.teamOf[seat] === 0 ? values.top : values.bottom](rng)),
});
console.log(`top: ${values.top}, bottom: ${values.bottom}`);
console.log(formatSummary(summarize(result)));
if (result.deadShapes.size) console.log('  deadlock shapes (pinned points):', [...result.deadShapes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5));
