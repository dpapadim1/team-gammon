import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, QUADRANT_PLAIN_4P, QUADRANT_PLAKOTO_4P, isDeadlocked, reverseCycle, winnerByPips, withCheckersPerSeat } from '../engine/index.js';
import { playRandom, pos } from '../testkit/helpers.js';

function audit(variant, seeds) {
  const wins = [0, 0];
  let turns = 0;
  let transfers = 0;
  let deadlocks = 0;
  for (const seed of seeds) {
    const lastPips = new Map();
    const game = playRandom(seed, {
      variant,
      beforeRoll(g) {
        const pos = g.position;
        assert.deepEqual(pos.checkInvariants(), [], `seed ${seed} turn ${g.turnNumber}`);
        const slotSeat = g.slotSeat;
        if (pos.isFinished(slotSeat)) {
          assert.notEqual(g.actor, slotSeat, 'a finished seat never plays');
          assert.ok(!pos.isFinished(g.actor));
          assert.equal(g.rules.teamOf[g.actor], g.rules.teamOf[slotSeat], 'its teammate plays instead');
        } else {
          assert.equal(g.actor, slotSeat);
        }
        for (let s = 0; s < g.rules.S; s++) {
          const pips = pos.pipsLeft(s);
          if (lastPips.has(s)) assert.ok(pips <= lastPips.get(s), 'pips never grow');
          lastPips.set(s, pips);
        }
      },
    });
    assert.ok(game.over, `seed ${seed} finished within the turn cap`);
    if (game.endReason === 'deadlock') {
      deadlocks++;
      assert.ok(isDeadlocked(game.position), `seed ${seed}: deadlock must be real`);
      assert.equal(game.winnerTeam, winnerByPips(game.position));
    } else {
      assert.equal(game.endReason, 'bearoff');
      for (const s of game.rules.teamSeats[game.winnerTeam]) assert.ok(game.position.isFinished(s));
      wins[game.winnerTeam]++;
    }
    turns += game.history.length;
    for (const entry of game.history) if (entry.actor !== game.rules.turnOrder[entry.slot]) transfers++;
    const replay = Game.replay(game.history, { variant });
    assert.ok(replay.position.sameAs(game.position), `seed ${seed} replays`);
    assert.deepEqual(replay.result(), game.result());
  }
  return { wins, turns, transfers, deadlocks, games: seeds.length };
}

test('random 8-checker games satisfy every invariant and always finish', () => {
  const seeds = Array.from({ length: 40 }, (_, i) => 1000 + i);
  const r = audit(QUADRANT_PLAKOTO_4P, seeds);
  const avg = r.turns / r.games;
  assert.ok(r.wins[0] > 0 && r.wins[1] > 0, `both teams win: ${r.wins}`);
  assert.ok(avg > 60 && avg < 250, `average game length ${avg}`);
  assert.ok(r.transfers > 0, 'idle-seat transfers happen');
  assert.equal(r.deadlocks, 0, 'the sanctuary rule prevents mutual-pin stalemates');
});

test('random games with the reversed turn cycle are just as sound', () => {
  const r = audit(reverseCycle(QUADRANT_PLAKOTO_4P), Array.from({ length: 20 }, (_, i) => 3000 + i));
  assert.ok(r.wins[0] > 0 && r.wins[1] > 0);
  assert.ok(r.transfers > 0);
});

test('plain pinning stalemates in some random games and the engine resolves them', () => {
  const r = audit(QUADRANT_PLAIN_4P, Array.from({ length: 40 }, (_, i) => 1000 + i));
  assert.ok(r.deadlocks > 0, 'the deadlock path is exercised');
  assert.ok(r.deadlocks < r.games, 'most games are still decided by bearing off');
});

test('random 3-checker games satisfy every invariant and always finish', () => {
  const seeds = Array.from({ length: 40 }, (_, i) => 2000 + i);
  const r = audit(withCheckersPerSeat(QUADRANT_PLAKOTO_4P, 3), seeds);
  assert.ok(r.turns / r.games < 120);
});

test('mutual corner pins are a real deadlock that the engine detects', () => {
  const g = playRandom(1004, { variant: QUADRANT_PLAIN_4P });
  assert.equal(g.endReason, 'deadlock');
  assert.equal(g.position.toText(), pos({ 1: 't1:7+b1:1!', 24: 't1:1!+b1:7' }, { t2: 8, b2: 8 }).toText());
  assert.deepEqual(g.result(), { winnerTeam: -1, reason: 'deadlock' });
});
