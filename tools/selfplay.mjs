// Usage: node tools/selfplay.mjs --out data/selfplay/run/iter-0001.bin [--games 2000] [--policy net|heuristic|random] [--net model.json]
//        [--epsilon 0.02] [--tau 0] [--workers 12] [--seed 1]
// Plays games and writes the positions after every turn as training data. Prints one JSON line with the statistics.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { Worker } from 'node:worker_threads';
import { mergeStats, playSelfPlay } from './lib/selfplay.js';
import { writeShard } from './lib/shards.js';

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    games: { type: 'string', default: '2000' },
    policy: { type: 'string', default: '' },
    net: { type: 'string', default: '' },
    epsilon: { type: 'string', default: '0.02' },
    tau: { type: 'string', default: '0' },
    workers: { type: 'string', default: String(Math.max(1, Math.min(12, os.availableParallelism() - 2))) },
    seed: { type: 'string', default: '1' },
  },
});
if (!values.out) throw new Error('--out is required');
const policy = values.policy || (values.net ? 'net' : 'heuristic');
if (policy === 'net' && !values.net) throw new Error('--policy net needs --net');

const options = { policy, netPath: values.net ? path.resolve(values.net) : '', epsilon: Number(values.epsilon), tau: Number(values.tau), seed: Number(values.seed) };
const total = Number(values.games);
const workers = Math.max(1, Math.min(Number(values.workers), total));
const started = Date.now();

function runWorker(w) {
  const count = Math.floor(total / workers) + (w < total % workers ? 1 : 0);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./lib/selfplay-worker.js', import.meta.url), { workerData: { ...options, first: w, step: workers, count } });
    worker.once('message', (m) => resolve({ ...m, games: Buffer.from(m.games), samples: Buffer.from(m.samples) }));
    worker.once('error', reject);
    worker.once('exit', (code) => code !== 0 && reject(new Error(`worker ${w} exited with ${code}`)));
  });
}

const results = workers === 1
  ? [(() => { const r = playSelfPlay({ ...options, first: 0, step: 1, count: total }); return { ...r.parts, stats: r.stats }; })()]
  : await Promise.all(Array.from({ length: workers }, (_, w) => runWorker(w)));
fs.mkdirSync(path.dirname(path.resolve(values.out)), { recursive: true });
writeShard(values.out, results);

const stats = mergeStats(results.map((r) => r.stats));
const seconds = (Date.now() - started) / 1000;
console.log(JSON.stringify({
  out: values.out,
  policy,
  games: stats.games,
  samples: results.reduce((n, r) => n + r.sampleCount, 0),
  unfinished: stats.unfinished,
  avgTurns: +(stats.turns / Math.max(1, stats.games)).toFixed(1),
  passesPerGame: +(stats.passes / Math.max(1, stats.games)).toFixed(2),
  topWinPct: +((100 * stats.wins[0]) / Math.max(1, stats.games)).toFixed(1),
  draws: stats.draws,
  deadlocks: stats.deadlocks,
  seconds: +seconds.toFixed(1),
  gamesPerSecond: +(stats.games / seconds).toFixed(1),
}));
