// Builds the puzzles of the puzzle page from self-play of the network.
//   node tools/puzzles.mjs generate --net models/champion.json --games 400 --raw data/puzzles-raw.jsonl [--workers 12] [--seed 1]
//   node tools/puzzles.mjs select --raw data/puzzles-raw.jsonl --count 60 --out client/puzzles.json
// Settings of the search can be changed with --opt name=value, e.g. --opt rollsB=300 --opt margin=0.05 (see DEFAULTS in tools/lib/puzzles.js).
// "generate" appends every puzzle it finds to the raw file while it runs, so an interrupted run loses nothing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import { Worker } from 'node:worker_threads';
import { DEFAULTS, selectPuzzles } from './lib/puzzles.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    net: { type: 'string', default: 'models/champion.json' },
    games: { type: 'string', default: '400' },
    workers: { type: 'string', default: String(Math.max(1, Math.min(12, os.availableParallelism() - 2))) },
    seed: { type: 'string', default: '1' },
    raw: { type: 'string', default: 'data/puzzles-raw.jsonl' },
    count: { type: 'string', default: '60' },
    out: { type: 'string', default: '' },
    opt: { type: 'string', multiple: true, default: [] },
  },
});
const command = positionals[0];
if (!['generate', 'select'].includes(command)) throw new Error('use "generate" or "select"');

const options = {};
for (const pair of values.opt) {
  const [key, value] = pair.split('=');
  if (!(key in DEFAULTS) || !Number.isFinite(Number(value))) throw new Error(`bad --opt ${pair}`);
  options[key] = Number(value);
}
const netFile = path.resolve(values.net);
const rawFile = path.resolve(values.raw);

function select() {
  const raw = fs.readFileSync(rawFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const puzzles = selectPuzzles(raw, Number(values.count));
  const tally = (items) => Object.entries(items.reduce((acc, k) => ({ ...acc, [k]: (acc[k] ?? 0) + 1 }), {})).map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(`${raw.length} puzzles found, ${puzzles.length} selected: ${tally(puzzles.map((p) => p.difficulty))}; themes ${tally(puzzles.map((p) => p.themes[0]))}`);
  if (!values.out) return;
  const meta = {
    version: 1,
    generated: new Date().toISOString().slice(0, 10),
    net: `${path.basename(netFile)} sha256:${crypto.createHash('sha256').update(fs.readFileSync(netFile)).digest('hex').slice(0, 12)}`,
    rollouts: { ...DEFAULTS, ...options }.rollsB,
  };
  const body = puzzles.map((p) => `    ${JSON.stringify(p)}`).join(',\n');
  fs.writeFileSync(path.resolve(values.out), `{\n  "version": ${meta.version},\n  "generated": "${meta.generated}",\n  "net": ${JSON.stringify(meta.net)},\n  "rollouts": ${meta.rollouts},\n  "puzzles": [\n${body}\n  ]\n}\n`);
  console.log(`wrote ${values.out}`);
}

if (command === 'select') {
  select();
} else {
  const total = Number(values.games);
  const workers = Math.max(1, Math.min(Number(values.workers), total));
  const started = Date.now();
  const progress = Array.from({ length: workers }, () => ({ games: 0, states: 0, screened: 0, puzzles: 0 }));
  let doneGames = 0;
  let found = 0;
  const report = () => {
    const sum = (key) => progress.reduce((n, p) => n + p[key], 0);
    console.log(`${((Date.now() - started) / 1000).toFixed(0)}s: ${doneGames}/${total} games, ${sum('states')} positions, ${sum('screened')} worth a look, ${found} puzzles`);
  };
  const run = (w) => new Promise((resolve, reject) => {
    const count = Math.floor(total / workers) + (w < total % workers ? 1 : 0);
    const worker = new Worker(new URL('./lib/puzzle-worker.js', import.meta.url), { workerData: { net: netFile, seed: Number(values.seed), first: w, step: workers, games: count, options } });
    worker.on('message', (m) => {
      if (m.type === 'puzzle') {
        found++;
        fs.appendFileSync(rawFile, `${JSON.stringify(m.puzzle)}\n`);
      } else if (m.type === 'game') {
        progress[w] = m.stats;
        doneGames++;
        if (doneGames % 10 === 0) report();
      } else {
        resolve();
      }
    });
    worker.once('error', reject);
    worker.once('exit', (code) => code !== 0 && reject(new Error(`worker ${w} exited with ${code}`)));
  });
  fs.mkdirSync(path.dirname(rawFile), { recursive: true });
  await Promise.all(Array.from({ length: workers }, (_, w) => run(w)));
  report();
  if (values.out) select();
}
