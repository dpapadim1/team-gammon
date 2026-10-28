import { parentPort, workerData } from 'node:worker_threads';
import { playMatch } from './arena.js';

parentPort.postMessage(playMatch(workerData));
