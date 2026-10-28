// Usage: node tools/arena.mjs --a net:models/champion.json --b heuristic [--games 1000] [--workers 12] [--seed 1] [--json]
// Bots: random, heuristic, level:N, net:<file>[?eps=0.05&tau=0.02]. A plays Top in even games and Bottom in odd games.
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Worker } from 'node:worker_threads';
import { mergeMatches, playMatch, summarizeMatch } from './lib/arena.js';

const { values } = parseArgs({
  options: {
    a: { type: 'string' },
    b: { type: 'string' },
    games: { type: 'string', default: '1000' },
    workers: { type: 'string', default: String(Math.max(1, Math.min(12, os.availableParallelism() - 2))) },
    seed: { type: 'string', default: '1' },
    json: { type: 'boolean', default: false },
  },
});
if (!values.a || !values.b) throw new Error('--a and --b are required');

// Relative net files are resolved here so worker threads agree on them.
const resolveSpec = (spec) => {
  if (!spec.startsWith('net:')) return spec;
  const rest = spec.slice(4);
  const q = rest.lastIndexOf('?');
  return `net:${path.resolve(q < 0 ? rest : rest.slice(0, q))}${q < 0 ? '' : rest.slice(q)}`;
};
const options = { a: resolveSpec(values.a), b: resolveSpec(values.b), seed: Number(values.seed) };
const total = Number(values.games);
const workers = Math.max(1, Math.min(Number(values.workers), total));
const started = Date.now();

const runWorker = (w) => new Promise((resolve, reject) => {
  const count = Math.floor(total / workers) + (w < total % workers ? 1 : 0);
  const worker = new Worker(new URL('./lib/arena-worker.js', import.meta.url), { workerData: { ...options, first: w, step: workers, count } });
  worker.once('message', resolve);
  worker.once('error', reject);
  worker.once('exit', (code) => code !== 0 && reject(new Error(`worker ${w} exited with ${code}`)));
});

const parts = workers === 1 ? [playMatch({ ...options, first: 0, step: 1, count: total })] : await Promise.all(Array.from({ length: workers }, (_, w) => runWorker(w)));
const summary = { a: values.a, b: values.b, ...summarizeMatch(mergeMatches(parts)), seconds: (Date.now() - started) / 1000 };
if (values.json) {
  console.log(JSON.stringify(summary));
} else {
  const pct = (x) => `${(100 * x).toFixed(1)}%`;
  console.log(`${summary.a} vs ${summary.b}: ${summary.games} games in ${summary.seconds.toFixed(1)}s`);
  console.log(`  A wins ${summary.aWins}, B wins ${summary.bWins}, draws ${summary.draws}${summary.unfinished ? `, unfinished ${summary.unfinished}` : ''}`);
  console.log(`  A win rate ${pct(summary.aWinRate)} (95% interval ${pct(summary.low)} to ${pct(summary.high)}), games last ${summary.avgTurns.toFixed(1)} turns`);
}
