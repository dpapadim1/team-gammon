import { parentPort, workerData } from 'node:worker_threads';
import { loadNetFile } from '../../bots/nn.js';
import { generate } from './puzzles.js';

const { net, ...job } = workerData;
const stats = generate(loadNetFile(net), {
  ...job,
  onPuzzle: (puzzle) => parentPort.postMessage({ type: 'puzzle', puzzle }),
  onGame: (game, progress) => parentPort.postMessage({ type: 'game', game, stats: { ...progress } }),
});
parentPort.postMessage({ type: 'done', stats });
