import { parentPort, workerData } from 'node:worker_threads';
import { playSelfPlay } from './selfplay.js';

const { parts, stats } = playSelfPlay(workerData);
const copy = (buf) => {
  const out = new Uint8Array(buf.length);
  out.set(buf);
  return out.buffer;
};
const games = copy(parts.games);
const samples = copy(parts.samples);
parentPort.postMessage({ games, samples, gameCount: parts.gameCount, sampleCount: parts.sampleCount, usedActive: parts.usedActive, stats }, [games, samples]);
