import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ValueNet } from './nn.js';

export const CHAMPION_FILE = fileURLToPath(new URL('../models/champion.json', import.meta.url));

const cache = new Map();

// The published value network, or null when there is none (a fresh checkout before the first training run). Read once.
export function loadChampion(file = CHAMPION_FILE) {
  if (!cache.has(file)) {
    let net = null;
    try {
      net = ValueNet.fromJSON(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`network ${file} ignored: ${err.message}`);
    }
    cache.set(file, net);
  }
  return cache.get(file);
}
