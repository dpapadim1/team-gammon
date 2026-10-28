// Usage: node tools/net-eval.mjs < request.json
// Request: { "net": "path/to/net.json", "samples": [{ "idx": [active inputs], "dense": [3 numbers] }] }
// Prints the logit of every sample as a JSON array. Used to check that trained networks load and compute the same numbers.
import fs from 'node:fs';
import { loadNetFile } from '../bots/nn.js';
import { DENSE_COUNT, MAX_ACTIVE, createFeatureBuffer } from '../bots/features.js';

const request = JSON.parse(fs.readFileSync(0, 'utf8'));
const net = loadNetFile(request.net);
const feat = createFeatureBuffer();
const logits = request.samples.map((s) => {
  if (s.idx.length > MAX_ACTIVE || s.dense.length !== DENSE_COUNT) throw new Error('sample does not fit the feature set');
  feat.idx.set(s.idx);
  feat.n = s.idx.length;
  feat.dense.set(s.dense);
  return net.logit(feat);
});
console.log(JSON.stringify(logits));
