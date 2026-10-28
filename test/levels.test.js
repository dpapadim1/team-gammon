import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRng, enumerateTurns, normalizeSteps, validateTurn } from '../engine/index.js';
import { BOT_LEVELS, createBotForLevel } from '../bots/levels.js';
import { loadChampion } from '../bots/champion.js';
import { createBotFromSpec } from '../bots/specs.js';
import { ValueNet, afterValue, createNetBot } from '../bots/nn.js';
import { playGame } from '../bots/arena.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-levels-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const randomNet = (seed) => ValueNet.random([12, 6], createRng(seed), 0.4);

test('levels 8 and 9 play the network when there is one and fall back to the heuristic otherwise', () => {
  const champion = randomNet(3);
  for (const level of [8, 9]) {
    for (const withNet of [champion, null]) {
      const bot = createBotForLevel(level, createRng(level), { champion: withNet });
      assert.equal(bot.level, level);
      assert.equal(bot.name, `${BOT_LEVELS[level].label} bot`);
      const { game } = playGame({ botFor: () => bot, seed: level, maxTurns: 40 });
      assert.ok(game.over || game.turnNumber >= 40, `level ${level} ${withNet ? 'with' : 'without'} a network`);
    }
  }
});

test('level 8 plays the best turn according to the network, except for an occasional random one', () => {
  const champion = randomNet(6);
  const bot = createBotForLevel(8, createRng(1), { champion });
  let decisions = 0;
  let best = 0;
  const counter = {
    chooseTurn(game) {
      const steps = bot.chooseTurn(game);
      const checked = validateTurn(game.position, game.actor, game.dice, normalizeSteps(steps));
      assert.ok(checked.ok);
      const team = game.rules.teamOf[game.actor];
      const nextSlot = (game.slot + 1) % game.rules.S;
      const turns = enumerateTurns(game.position, game.actor, game.dice, { limits: game.limits, withPositions: true });
      const top = Math.max(...turns.map((t) => afterValue(champion, t.after, team, nextSlot)));
      if (afterValue(champion, checked.after, team, nextSlot) >= top - 1e-9) best++;
      decisions++;
      return steps;
    },
  };
  assert.ok(playGame({ botFor: () => counter, seed: 12 }).game.over);
  assert.ok(decisions > 50);
  assert.ok(best < decisions, 'some turns are random');
  assert.ok(best > 0.8 * decisions, 'most turns are the best one');
});

test('level 9 plays like a network bot that looks two plies ahead', () => {
  const champion = randomNet(4);
  const bot = createBotForLevel(9, createRng(1), { champion });
  const reference = createNetBot(champion, createRng(2), { plies: 2, candidates: 5 });
  let decisions = 0;
  const checker = {
    chooseTurn(game) {
      const steps = bot.chooseTurn(game);
      assert.ok(validateTurn(game.position, game.actor, game.dice, normalizeSteps(steps)).ok);
      assert.deepEqual(steps, reference.chooseTurn(game));
      decisions++;
      return steps;
    },
  };
  playGame({ botFor: () => checker, seed: 12, maxTurns: 40 });
  assert.ok(decisions >= 30);
});

test('a missing or broken network file is not an error', () => {
  assert.equal(loadChampion(path.join(tmp, 'nothing.json')), null);
  const broken = path.join(tmp, 'broken.json');
  fs.writeFileSync(broken, '{"format": "team-gammon-value-net"');
  const warn = console.warn;
  const warnings = [];
  console.warn = (m) => warnings.push(m);
  try {
    assert.equal(loadChampion(broken), null);
  } finally {
    console.warn = warn;
  }
  assert.equal(warnings.length, 1);
  const good = path.join(tmp, 'good.json');
  fs.writeFileSync(good, JSON.stringify(randomNet(2)));
  assert.deepEqual(loadChampion(good).sizes, [12, 6]);
  assert.equal(loadChampion(good), loadChampion(good), 'read once');
});

test('bot descriptions for the tools', () => {
  const file = path.join(tmp, 'spec.json');
  fs.writeFileSync(file, JSON.stringify(randomNet(5)));
  for (const spec of ['random', 'heuristic', 'level:3', `net:${file}`, `net:${file}?eps=0.1&tau=0.02`]) {
    const bot = createBotFromSpec(spec, createRng(1));
    assert.ok(playGame({ botFor: () => bot, seed: 3 }).game.over, spec);
  }
  assert.throws(() => createBotFromSpec('chess', createRng(1)), /unknown bot/);
});
