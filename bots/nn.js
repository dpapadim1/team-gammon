import fs from 'node:fs';
import { enumerateTurns } from '../engine/index.js';
import { DENSE_COUNT, FEATURES_VERSION, SPARSE_COUNT, createFeatureBuffer, encoderFor } from './features.js';

const FORMAT = 'team-gammon-value-net';

function toBase64(array) {
  const buf = Buffer.alloc(array.length * 4);
  for (let i = 0; i < array.length; i++) buf.writeFloatLE(array[i], i * 4);
  return buf.toString('base64');
}

function fromBase64(text, length, what) {
  const buf = Buffer.from(text, 'base64');
  if (buf.length !== length * 4) throw new Error(`${what}: expected ${length} numbers, found ${buf.length / 4}`);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = buf.readFloatLE(i * 4);
  return out;
}

const relu = (a) => {
  for (let i = 0; i < a.length; i++) if (a[i] < 0) a[i] = 0;
};

// Value network: sparse binary inputs and three dense numbers, ReLU hidden layers, one logit; value = sigmoid(logit)
// is the chance that the team that has just moved wins. Matrices are stored [input][output].
export class ValueNet {
  constructor({ first, hidden, output, meta = {} }) {
    this.w1 = first.weights;
    this.wd = first.denseWeights;
    this.b1 = first.bias;
    this.hidden = hidden.map((layer) => ({ ...layer, act: new Float32Array(layer.outSize) }));
    this.wOut = output.weights;
    this.bOut = output.bias;
    this.act1 = new Float32Array(this.b1.length);
    this.meta = meta;
  }

  get sizes() {
    return [this.b1.length, ...this.hidden.map((l) => l.outSize)];
  }

  // Small random weights, for tests and as a starting point.
  static random(sizes, rng, scale = 0.1) {
    const fill = (n) => Float32Array.from({ length: n }, () => (rng.float() * 2 - 1) * scale);
    const first = { weights: fill(SPARSE_COUNT * sizes[0]), denseWeights: fill(DENSE_COUNT * sizes[0]), bias: fill(sizes[0]) };
    const hidden = [];
    for (let i = 1; i < sizes.length; i++) {
      hidden.push({ inSize: sizes[i - 1], outSize: sizes[i], weights: fill(sizes[i - 1] * sizes[i]), bias: fill(sizes[i]) });
    }
    return new ValueNet({ first, hidden, output: { weights: fill(sizes[sizes.length - 1]), bias: Math.fround((rng.float() * 2 - 1) * scale) } });
  }

  logit(feat) {
    const h = this.act1;
    const H = h.length;
    h.set(this.b1);
    const w1 = this.w1;
    const idx = feat.idx;
    for (let i = 0, n = feat.n; i < n; i++) {
      const base = idx[i] * H;
      for (let j = 0; j < H; j++) h[j] += w1[base + j];
    }
    const wd = this.wd;
    for (let d = 0; d < DENSE_COUNT; d++) {
      const x = feat.dense[d];
      if (x === 0) continue;
      const base = d * H;
      for (let j = 0; j < H; j++) h[j] += x * wd[base + j];
    }
    relu(h);
    let prev = h;
    for (const layer of this.hidden) {
      const out = layer.act;
      const nOut = layer.outSize;
      const w = layer.weights;
      out.set(layer.bias);
      for (let i = 0; i < layer.inSize; i++) {
        const x = prev[i];
        if (x === 0) continue;
        const base = i * nOut;
        for (let j = 0; j < nOut; j++) out[j] += x * w[base + j];
      }
      relu(out);
      prev = out;
    }
    let z = this.bOut;
    const wo = this.wOut;
    for (let i = 0; i < prev.length; i++) z += prev[i] * wo[i];
    return z;
  }

  value(feat) {
    return 1 / (1 + Math.exp(-this.logit(feat)));
  }

  toJSON() {
    const layers = [{
      in: SPARSE_COUNT,
      out: this.b1.length,
      weights: toBase64(this.w1),
      denseWeights: toBase64(this.wd),
      bias: toBase64(this.b1),
    }];
    for (const l of this.hidden) layers.push({ in: l.inSize, out: l.outSize, weights: toBase64(l.weights), bias: toBase64(l.bias) });
    layers.push({ in: this.wOut.length, out: 1, weights: toBase64(this.wOut), bias: toBase64([this.bOut]) });
    return { format: FORMAT, featuresVersion: FEATURES_VERSION, sparse: SPARSE_COUNT, dense: DENSE_COUNT, layers, meta: this.meta };
  }

  static fromJSON(json) {
    if (json?.format !== FORMAT) throw new Error('not a team-gammon value network');
    if (json.featuresVersion !== FEATURES_VERSION || json.sparse !== SPARSE_COUNT || json.dense !== DENSE_COUNT) {
      throw new Error('the network was trained for a different feature set');
    }
    const { layers } = json;
    if (!Array.isArray(layers) || layers.length < 2) throw new Error('a network needs at least a hidden and an output layer');
    const [firstSpec, ...rest] = layers;
    const outSpec = rest.pop();
    if (firstSpec.in !== SPARSE_COUNT) throw new Error('first layer does not match the feature set');
    const H = firstSpec.out;
    const first = {
      weights: fromBase64(firstSpec.weights, SPARSE_COUNT * H, 'first layer'),
      denseWeights: fromBase64(firstSpec.denseWeights, DENSE_COUNT * H, 'first layer (dense inputs)'),
      bias: fromBase64(firstSpec.bias, H, 'first layer bias'),
    };
    let width = H;
    const hidden = rest.map((spec, i) => {
      if (spec.in !== width) throw new Error(`layer ${i + 2} does not follow the previous one`);
      width = spec.out;
      return { inSize: spec.in, outSize: spec.out, weights: fromBase64(spec.weights, spec.in * spec.out, `layer ${i + 2}`), bias: fromBase64(spec.bias, spec.out, `layer ${i + 2} bias`) };
    });
    if (outSpec.in !== width || outSpec.out !== 1) throw new Error('output layer does not match the last hidden layer');
    const output = { weights: fromBase64(outSpec.weights, width, 'output layer'), bias: fromBase64(outSpec.bias, 1, 'output bias')[0] };
    return new ValueNet({ first, hidden, output, meta: json.meta ?? {} });
  }
}

const loaded = new Map();

// Reads a network file once per process.
export function loadNetFile(path) {
  let net = loaded.get(path);
  if (!net) {
    net = ValueNet.fromJSON(JSON.parse(fs.readFileSync(path, 'utf8')));
    loaded.set(path, net);
  }
  return net;
}

// Value of `position` for `team`, which has just produced it; `nextSlot` is the turn slot that follows.
export function afterValue(net, position, team, nextSlot, feat = createFeatureBuffer()) {
  if (position.teamFinished(team)) return 1;
  encoderFor(position.rules).encode(position, team, nextSlot, feat);
  return net.value(feat);
}

// Picks an index: exploration with probability `epsilon`, otherwise the best value, or a softmax draw when tau > 0.
export function pickIndex(values, rng, { epsilon = 0, tau = 0 } = {}) {
  const n = values.length;
  if (epsilon > 0 && rng.float() < epsilon) return rng.int(n);
  let best = 0;
  for (let i = 1; i < n; i++) if (values[i] > values[best]) best = i;
  if (tau > 0) {
    let sum = 0;
    const weights = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      weights[i] = Math.exp((values[i] - values[best]) / tau);
      sum += weights[i];
    }
    let r = rng.float() * sum;
    for (let i = 0; i < n; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return best;
  }
  let ties = 0;
  let pick = best;
  for (let i = 0; i < n; i++) {
    if (Math.abs(values[i] - values[best]) <= 1e-12 && rng.int(++ties) === 0) pick = i;
  }
  return pick;
}

// Expected value for the mover's team of the position after it plays `steps`, when the next player rolls and answers with
// the turn the network likes best for them. Weighted over the 21 rolls; the mover's own turn is not repeated.
export function replyValue(net, game, steps, feat = createFeatureBuffer()) {
  const rules = game.rules;
  const team = rules.teamOf[game.actor];
  const after = game.clone();
  after.playTurn(steps);
  if (after.over) return after.winnerTeam === team ? 1 : after.winnerTeam === -1 ? 0.5 : 0;
  const foe = rules.teamOf[after.actor];
  if (foe === team) return afterValue(net, after.position, team, after.slot, feat);
  let total = 0;
  for (let a = 1; a <= 6; a++) {
    for (let b = a; b <= 6; b++) {
      const reply = after.clone();
      const rolled = reply.roll([a, b]);
      let best;
      if (reply.over) {
        best = reply.winnerTeam === foe ? 1 : reply.winnerTeam === -1 ? 0.5 : 0;
      } else if (rolled.passed) {
        best = afterValue(net, reply.position, foe, reply.slot, feat);
      } else {
        best = 0;
        const nextSlot = (reply.slot + 1) % rules.S;
        for (const turn of enumerateTurns(reply.position, reply.actor, reply.dice, { limits: reply.limits, withPositions: true })) {
          const v = afterValue(net, turn.after, foe, nextSlot, feat);
          if (v > best) best = v;
        }
      }
      total += (a === b ? 1 : 2) * (1 - best);
    }
  }
  return total / 36;
}

// A bot that plays the turn whose resulting position the network likes best. With plies = 2 the best `candidates` turns
// by that measure are looked at again, after the opponent's best answer to each of the 21 rolls.
export function createNetBot(net, rng, { epsilon = 0, tau = 0, plies = 1, candidates = 5, name = 'net' } = {}) {
  const feat = createFeatureBuffer();
  const bot = {
    name,
    net,
    scoreTurns(game, turns) {
      const team = game.rules.teamOf[game.actor];
      const nextSlot = (game.slot + 1) % game.rules.S;
      return Float64Array.from(turns, (turn) => afterValue(net, turn.after, team, nextSlot, feat));
    },
    chooseTurn(game) {
      const turns = enumerateTurns(game.position, game.actor, game.dice, { limits: game.limits, withPositions: true });
      if (turns.length === 1) return turns[0].steps;
      const values = bot.scoreTurns(game, turns);
      if (plies < 2) return turns[pickIndex(values, rng, { epsilon, tau })].steps;
      const order = Array.from(values.keys()).sort((i, j) => values[j] - values[i]).slice(0, candidates);
      const deeper = Float64Array.from(order, (i) => replyValue(net, game, turns[i].steps, feat));
      return turns[order[pickIndex(deeper, rng, { epsilon, tau })]].steps;
    },
  };
  return bot;
}
