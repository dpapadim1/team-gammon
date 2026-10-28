import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRng } from '../engine/index.js';
import { ValueNet } from '../bots/nn.js';
import { SPARSE_COUNT } from '../bots/features.js';
import { playSelfPlay } from '../tools/lib/selfplay.js';
import { readShard, writeShard } from '../tools/lib/shards.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-selfplay-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function roundTrip(parts, name) {
  const file = path.join(tmp, name);
  writeShard(file, Array.isArray(parts) ? parts : [parts]);
  return readShard(file);
}

test('self-play files hold the position after every turn but the last, with the outcome of the game', () => {
  const { parts, stats } = playSelfPlay({ policy: 'heuristic', epsilon: 0.1, seed: 5, count: 6 });
  assert.equal(stats.games, 6);
  assert.equal(stats.unfinished, 0);
  const shard = roundTrip(parts, 'a.bin');
  assert.equal(shard.info.gameCount, 6);
  assert.equal(shard.info.sampleCount, parts.sampleCount);
  assert.equal(shard.info.sparse, SPARSE_COUNT);
  assert.equal(shard.info.usedActive, Math.max(...shard.samples.map((s) => s.idx.length)), 'the header says how many inputs are ever active');
  assert.equal(shard.games.reduce((n, g) => n + g.samples, 0), shard.samples.length);
  assert.equal(shard.games.reduce((n, g) => n + g.samples + 1, 0), stats.turns, 'every turn but the last is a sample');

  let at = 0;
  for (const game of shard.games) {
    const own = shard.samples.slice(at, at + game.samples);
    at += game.samples;
    own.forEach((s, i) => {
      if (i > 0) assert.notEqual(s.team, own[i - 1].team, 'the teams alternate every turn');
      assert.equal(new Set(s.idx).size, s.idx.length);
      assert.ok(s.idx.every((v) => v < SPARSE_COUNT));
      const checkerUnits = s.idx.filter((v) => v < 768 || (v >= 864 && v < 896)).length;
      assert.equal(checkerUnits, 32);
    });
    assert.notEqual(game.lastTeam, own[own.length - 1].team, 'the last move belongs to the other team');
    assert.ok(game.outcome === 2 || stats.deadlocks > 0, 'the team that makes the last move wins unless the game is blocked');
  }
});

test('the same games come out however they are shared between workers', () => {
  const digest = (shard) => {
    const out = [];
    let at = 0;
    for (const g of shard.games) {
      out.push(JSON.stringify([g.lastTeam, g.outcome, shard.samples.slice(at, at + g.samples)]));
      at += g.samples;
    }
    return out.sort();
  };
  const whole = roundTrip(playSelfPlay({ policy: 'heuristic', epsilon: 0.05, seed: 9, count: 6 }).parts, 'whole.bin');
  const halves = [0, 1].map((first) => playSelfPlay({ policy: 'heuristic', epsilon: 0.05, seed: 9, first, step: 2, count: 3 }).parts);
  const shared = roundTrip(halves, 'shared.bin');
  assert.deepEqual(digest(shared), digest(whole));
});

test('network self-play works with exploration and finishes every game', () => {
  const netPath = path.join(tmp, 'net.json');
  fs.writeFileSync(netPath, JSON.stringify(ValueNet.random([10, 6], createRng(3), 0.3)));
  const { parts, stats } = playSelfPlay({ policy: 'net', netPath, epsilon: 0.05, tau: 0.02, seed: 2, count: 3 });
  assert.equal(stats.games, 3);
  assert.equal(stats.unfinished, 0);
  assert.ok(parts.sampleCount > 100);
});

test('the command line tool writes a readable file from several workers', () => {
  const out = path.join(tmp, 'cli.bin');
  const stdout = execFileSync(process.execPath, [path.resolve('tools/selfplay.mjs'), '--out', out, '--games', '7', '--workers', '3', '--policy', 'heuristic', '--seed', '4'], { encoding: 'utf8' });
  const summary = JSON.parse(stdout.trim().split('\n').pop());
  assert.equal(summary.games, 7);
  const shard = readShard(out);
  assert.equal(shard.info.gameCount, 7);
  assert.equal(shard.info.sampleCount, summary.samples);
});
