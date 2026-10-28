import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, QUADRANT_PLAKOTO_4P, enumerateTurns, normalizeSteps, validateTurn, createRng } from '../engine/index.js';
import { DENSE_COUNT, FEATURES_VERSION, SPARSE_COUNT, createFeatureBuffer, encoderFor, expand } from '../bots/features.js';
import { ValueNet, afterValue, createNetBot, pickIndex, replyValue } from '../bots/nn.js';
import { createRandomBot } from '../bots/random.js';
import { playGame } from '../bots/arena.js';
import { pos, rules } from '../testkit/helpers.js';

// Plain dense implementation of the same network, in double precision.
function reference(net, x) {
  const relu = (v) => (v > 0 ? v : 0);
  const H = net.b1.length;
  let h = Array.from(net.b1);
  for (let i = 0; i < SPARSE_COUNT; i++) {
    if (x[i] !== 0) for (let j = 0; j < H; j++) h[j] += x[i] * net.w1[i * H + j];
  }
  for (let d = 0; d < DENSE_COUNT; d++) for (let j = 0; j < H; j++) h[j] += x[SPARSE_COUNT + d] * net.wd[d * H + j];
  h = h.map(relu);
  for (const layer of net.hidden) {
    const out = Array.from(layer.bias);
    for (let i = 0; i < layer.inSize; i++) for (let j = 0; j < layer.outSize; j++) out[j] += h[i] * layer.weights[i * layer.outSize + j];
    h = out.map(relu);
  }
  return h.reduce((z, v, i) => z + v * net.wOut[i], net.bOut);
}

// Feature buffers of many real positions.
function samplePositions(count, seed = 5) {
  const rng = createRng(seed);
  const bot = createRandomBot(rng);
  const out = [];
  for (let g = 1; out.length < count; g++) {
    playGame({
      botFor: () => bot,
      seed: seed * 100 + g,
      onTurn: (game) => {
        if (game.over || rng.int(7) !== 0 || out.length >= count) return;
        const team = game.rules.teamOf[game.history.at(-1).actor];
        const feat = encoderFor(game.rules).encode(game.position, team, game.slot, createFeatureBuffer());
        out.push({ idx: feat.idx.slice(), n: feat.n, dense: feat.dense.slice() });
      },
    });
  }
  return out;
}

test('the forward pass matches a plain dense implementation', () => {
  const net = ValueNet.random([24, 12], createRng(3), 0.3);
  for (const feat of samplePositions(40)) {
    const expected = reference(net, expand(feat));
    assert.ok(Math.abs(net.logit(feat) - expected) < 1e-4, `${net.logit(feat)} vs ${expected}`);
  }
  const deep = ValueNet.random([16, 10, 6], createRng(8), 0.3);
  for (const feat of samplePositions(20, 6)) assert.ok(Math.abs(deep.logit(feat) - reference(deep, expand(feat))) < 1e-4);
  const shallow = ValueNet.random([9], createRng(9), 0.3);
  for (const feat of samplePositions(10, 7)) assert.ok(Math.abs(shallow.logit(feat) - reference(shallow, expand(feat))) < 1e-4);
});

test('values are probabilities and a network survives a JSON round trip unchanged', () => {
  const net = ValueNet.random([20, 8], createRng(11), 0.4);
  net.meta = { iteration: 7, note: 'test' };
  const copy = ValueNet.fromJSON(JSON.parse(JSON.stringify(net)));
  assert.deepEqual(copy.sizes, [20, 8]);
  assert.deepEqual(copy.meta, { iteration: 7, note: 'test' });
  for (const feat of samplePositions(30, 2)) {
    assert.equal(copy.logit(feat), net.logit(feat));
    const v = net.value(feat);
    assert.ok(v > 0 && v < 1);
  }
});

test('networks that do not fit the feature set are refused', () => {
  const good = JSON.parse(JSON.stringify(ValueNet.random([6, 4], createRng(1))));
  assert.doesNotThrow(() => ValueNet.fromJSON(good));
  const mutate = (fn) => {
    const copy = JSON.parse(JSON.stringify(good));
    fn(copy);
    return copy;
  };
  assert.throws(() => ValueNet.fromJSON(mutate((j) => { j.format = 'something else'; })), /not a team-gammon/);
  assert.throws(() => ValueNet.fromJSON(mutate((j) => { j.featuresVersion = FEATURES_VERSION + 1; })), /different feature set/);
  assert.throws(() => ValueNet.fromJSON(mutate((j) => { j.layers[0].weights = j.layers[0].weights.slice(8); })), /first layer/);
  assert.throws(() => ValueNet.fromJSON(mutate((j) => { j.layers[1].in = 5; })), /does not follow/);
  assert.throws(() => ValueNet.fromJSON(mutate((j) => { j.layers[2].out = 2; })), /output layer/);
  assert.throws(() => ValueNet.fromJSON(mutate((j) => { j.layers = j.layers.slice(0, 1); })), /at least/);
});

test('a finished team is worth exactly 1, whatever the network says', () => {
  const net = ValueNet.random([8, 4], createRng(2), 0.5);
  const won = pos({ 2: 'b1:3' }, { t1: 8, t2: 8 });
  assert.equal(afterValue(net, won, 0, 1), 1);
  const v = afterValue(net, won, 1, 2);
  assert.ok(v > 0 && v < 1);
});

test('pickIndex: best value, exploration, softmax draws and fair ties', () => {
  const rng = createRng(1);
  const values = Float64Array.from([0.2, 0.7, 0.4]);
  assert.equal(pickIndex(values, rng), 1);
  const explored = new Set();
  for (let i = 0; i < 200; i++) explored.add(pickIndex(values, rng, { epsilon: 1 }));
  assert.deepEqual([...explored].sort(), [0, 1, 2]);
  const counts = [0, 0, 0];
  for (let i = 0; i < 3000; i++) counts[pickIndex(values, rng, { tau: 0.1 })]++;
  assert.ok(counts[1] > counts[2] && counts[2] > counts[0], `softmax prefers better values: ${counts}`);
  const ties = [0, 0, 0, 0];
  for (let i = 0; i < 4000; i++) ties[pickIndex(Float64Array.from([0.5, 0.5, 0.1, 0.5]), rng)]++;
  assert.equal(ties[2], 0);
  assert.ok(ties[0] > 1100 && ties[1] > 1100 && ties[3] > 1100, `ties are broken evenly: ${ties}`);
});

test('the net bot plays the legal turn with the best value and finishes games', () => {
  const net = ValueNet.random([16, 8], createRng(21), 0.4);
  const rng = createRng(7);
  const bot = createNetBot(net, rng);
  let decisions = 0;
  const checker = {
    chooseTurn(game) {
      const steps = bot.chooseTurn(game);
      const checked = validateTurn(game.position, game.actor, game.dice, normalizeSteps(steps));
      assert.ok(checked.ok, 'the turn is legal');
      const team = game.rules.teamOf[game.actor];
      const nextSlot = (game.slot + 1) % game.rules.S;
      const turns = enumerateTurns(game.position, game.actor, game.dice, { limits: game.limits, withPositions: true });
      const best = Math.max(...turns.map((t) => afterValue(net, t.after, team, nextSlot)));
      assert.ok(afterValue(net, checked.after, team, nextSlot) >= best - 1e-9, 'no afterstate is better than the chosen one');
      decisions++;
      return steps;
    },
  };
  for (let seed = 1; seed <= 4; seed++) {
    const { game } = playGame({ botFor: () => checker, seed });
    assert.ok(game.over);
  }
  assert.ok(decisions > 200);
});

test('exploring net bots still play legal turns', () => {
  const net = ValueNet.random([12, 6], createRng(5), 0.4);
  for (const options of [{ epsilon: 1 }, { tau: 0.05 }, { epsilon: 0.2, tau: 0.02 }]) {
    const bot = createNetBot(net, createRng(3), options);
    const { game } = playGame({ botFor: () => bot, seed: 9 });
    assert.ok(game.over, JSON.stringify(options));
  }
});

test('a value network can be compared with the rules it was built for', () => {
  assert.equal(rules.S, 4);
  const net = ValueNet.random([4], createRng(1));
  assert.deepEqual(net.sizes, [4]);
});

test('reply value: a finished game is worth 1 and an even network is worth one half', () => {
  const flat = ValueNet.random([4], createRng(1), 0);
  const start = new Game(QUADRANT_PLAKOTO_4P, { firstSlot: 0 });
  start.roll([3, 1]);
  const turn = enumerateTurns(start.position, start.actor, start.dice, { limits: start.limits })[0];
  assert.ok(Math.abs(replyValue(flat, start, turn.steps) - 0.5) < 1e-12, 'the 21 rolls are weighted to sum to 1');

  const nearlyDone = new Game(QUADRANT_PLAKOTO_4P, { firstSlot: 0, position: pos({ 1: 't1:1', 19: 'b1:8', 21: 'b2:8' }, { t1: 7, t2: 8 }) });
  nearlyDone.roll([1, 1]);
  assert.equal(replyValue(randomNet(), nearlyDone, [{ from: 1, die: 1 }]), 1, 'bearing off the last checker wins');
});

function randomNet() {
  return ValueNet.random([10, 6], createRng(31), 0.4);
}

test('the two-ply bot chooses among the best one-ply turns by the opponent\'s answers', () => {
  const net = randomNet();
  const bot = createNetBot(net, createRng(2), { plies: 2, candidates: 3 });
  let decisions = 0;
  const checker = {
    chooseTurn(game) {
      const steps = bot.chooseTurn(game);
      const checked = validateTurn(game.position, game.actor, game.dice, normalizeSteps(steps));
      assert.ok(checked.ok);
      const turns = enumerateTurns(game.position, game.actor, game.dice, { limits: game.limits, withPositions: true });
      if (turns.length > 1) {
        const team = game.rules.teamOf[game.actor];
        const nextSlot = (game.slot + 1) % game.rules.S;
        const first = turns.map((t) => afterValue(net, t.after, team, nextSlot));
        const order = first.map((v, i) => i).sort((i, j) => first[j] - first[i]).slice(0, 3);
        const chosen = turns.findIndex((t) => t.key === checked.after.key());
        assert.ok(order.includes(chosen), 'only the best one-ply turns are looked at again');
        const deeper = order.map((i) => replyValue(net, game, turns[i].steps));
        assert.ok(deeper[order.indexOf(chosen)] >= Math.max(...deeper) - 1e-9, 'and the best of them is played');
        decisions++;
      }
      return steps;
    },
  };
  assert.ok(playGame({ botFor: () => checker, seed: 21 }).game.over);
  assert.ok(decisions > 30);
});
