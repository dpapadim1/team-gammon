import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUADRANT_PLAIN_4P,
  applyTurn,
  createRng,
  diceList,
  enumerateTurns,
  legalNextSteps,
  turnLimits,
  validateTurn,
} from '../engine/index.js';
import { canonical, fromPosition, legalSequences, nextStepKeys } from '../testkit/oracle.js';
import { playRandom, seqKey } from '../testkit/helpers.js';

const GAMES = 10;

function mutate(steps, rng) {
  const out = steps.map((st) => ({ from: st.from, die: st.die }));
  const choice = rng.int(out.length === 0 ? 1 : 5);
  if (choice === 0) {
    out.push({ from: 1 + rng.int(24), die: rng.die() });
  } else if (choice === 1) {
    out[rng.int(out.length)].from = 1 + rng.int(24);
  } else if (choice === 2) {
    out[rng.int(out.length)].die = rng.die();
  } else if (choice === 3) {
    out.pop();
  } else if (out.length >= 2) {
    [out[0], out[1]] = [out[1], out[0]];
  }
  return out;
}

function compare(position, seat, dice, rng) {
  const { target, legal } = legalSequences(fromPosition(position), seat, dice);
  const expected = [...new Set(legal.map((f) => canonical(f.state)))].sort();

  const limits = turnLimits(position, seat, dice);
  assert.equal(limits.target, target, `target for ${position} seat ${seat} dice ${dice}`);

  const turns = enumerateTurns(position, seat, dice, { limits });
  const got = turns.map((t) => {
    const after = position.clone();
    applyTurn(after, seat, t.steps);
    assert.equal(after.key(), t.key);
    assert.deepEqual(after.checkInvariants({ conservation: false }), []);
    return after.toText();
  });
  assert.equal(new Set(got).size, got.length, 'engine returns distinct outcomes');
  assert.deepEqual([...got].sort(), expected, `outcomes for ${position} seat ${seat} dice ${dice}`);

  // Next-step sets must match the oracle along one random legal sequence.
  const pick = legal[rng.int(legal.length)];
  const work = position.clone();
  const remaining = diceList(dice);
  for (let i = 0; i <= pick.steps.length; i++) {
    const want = [...nextStepKeys(legal, pick.steps.slice(0, i))].sort();
    const have = legalNextSteps(work, seat, remaining, i, limits).map((st) => `${st.from}:${st.die}`).sort();
    assert.deepEqual(have, want, `next steps after ${i} steps for ${position} seat ${seat} dice ${dice}`);
    if (i < pick.steps.length) {
      const st = pick.steps[i];
      work.applyStep(seat, st.from, st.die);
      remaining.splice(remaining.indexOf(st.die), 1);
    }
  }

  // validateTurn must agree with the oracle on legal and on corrupted sequences.
  const legalKeys = new Set(legal.map((f) => seqKey(f.steps)));
  assert.ok(validateTurn(position, seat, dice, pick.steps).ok);
  for (let i = 0; i < 3; i++) {
    const bad = mutate(pick.steps, rng);
    assert.equal(validateTurn(position, seat, dice, bad).ok, legalKeys.has(seqKey(bad)), `validate ${seqKey(bad)}`);
  }
}

test('engine agrees with the reference oracle on positions from random games', () => {
  const rng = createRng(2024);
  let positions = 0;
  let doubles = 0;
  let bearOffs = 0;
  for (let g = 0; g < GAMES; g++) {
    playRandom(500 + g, {
      beforeRoll(game, dice) {
        compare(game.position, game.actor, dice, rng);
        compare(game.position, rng.int(game.rules.S), rng.roll(), rng);
        positions += 2;
        if (dice[0] === dice[1]) doubles++;
        if (game.position.allHome(game.actor)) bearOffs++;
      },
    });
  }
  assert.ok(positions > 1000, `compared ${positions} positions`);
  assert.ok(doubles > 20, 'doubles were exercised');
  assert.ok(bearOffs > 20, 'bear-off positions were exercised');
});

test('engine agrees with the oracle under plain pinning (no sanctuary)', () => {
  const rng = createRng(77);
  let positions = 0;
  for (let g = 0; g < 4; g++) {
    playRandom(900 + g, {
      variant: QUADRANT_PLAIN_4P,
      beforeRoll(game, dice) {
        compare(game.position, game.actor, dice, rng);
        positions++;
      },
    });
  }
  assert.ok(positions > 200, `compared ${positions} positions`);
});
