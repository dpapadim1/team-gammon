import test from 'node:test';
import assert from 'node:assert/strict';
import { QUADRANT_PLAKOTO_4P, createRng } from '../engine/index.js';
import { createHeuristicBot, DEFAULT_PARAMS, evaluate, exposure, foesAfter } from '../bots/heuristic.js';
import { createRandomBot } from '../bots/random.js';
import { playGame } from '../bots/arena.js';
import { runBatch } from '../bots/stats.js';
import { B1, B2, T1, pos } from '../testkit/helpers.js';

test('bots only play legal turns and always finish games', () => {
  const rng = createRng(5);
  const bots = [createRandomBot(rng), createHeuristicBot(rng), createRandomBot(rng), createHeuristicBot(rng)];
  for (let seed = 1; seed <= 12; seed++) {
    const { game } = playGame({ botFor: (s) => bots[s], seed });
    assert.ok(game.over, `seed ${seed}`);
  }
});

test('games are reproducible from the seed', () => {
  const run = () => {
    const rng = createRng(3);
    const bots = [0, 1, 2, 3].map(() => createHeuristicBot(rng));
    return playGame({ botFor: (s) => bots[s], seed: 77 }).game;
  };
  const a = run();
  const b = run();
  assert.deepEqual(a.history, b.history);
  assert.deepEqual(a.result(), b.result());
});

test('the heuristic beats random play from either side', () => {
  const heuristicTop = runBatch({
    variant: QUADRANT_PLAKOTO_4P,
    games: 80,
    seed: 11,
    makeBots: (rng, R) => Array.from({ length: R.S }, (_, s) => (R.teamOf[s] === 0 ? createHeuristicBot(rng) : createRandomBot(rng))),
  });
  const heuristicBottom = runBatch({
    variant: QUADRANT_PLAKOTO_4P,
    games: 80,
    seed: 12,
    makeBots: (rng, R) => Array.from({ length: R.S }, (_, s) => (R.teamOf[s] === 1 ? createHeuristicBot(rng) : createRandomBot(rng))),
  });
  assert.ok(heuristicTop.wins[0] >= 64, `heuristic as Top won ${heuristicTop.wins[0]}/80`);
  assert.ok(heuristicBottom.wins[1] >= 64, `heuristic as Bottom won ${heuristicBottom.wins[1]}/80`);
});

test('evaluation prefers safe checkers and punishes pins', () => {
  const foes = [B1, B2];
  const safetyOnly = { ...DEFAULT_PARAMS, race: 0 };

  // A lone checker 6 pips in front of the enemy stack is easier to hit than one 9 pips away.
  const near = evaluate(pos({ 10: 't1:1', 4: 'b1:8' }), 0, foes, safetyOnly);
  const far = evaluate(pos({ 10: 't1:1', 1: 'b1:8' }), 0, foes, safetyOnly);
  assert.ok(near < far, `near ${near} should score below far ${far}`);

  // No enemy checker can reach the lone checker once it has been passed.
  const passed = evaluate(pos({ 10: 't1:1', 15: 'b1:8' }), 0, foes, safetyOnly);
  assert.equal(passed, 0);

  // Being pinned is bad, pinning is good.
  const pinnedOwn = evaluate(pos({ 10: 't1:1!+b1:1' }), 0, foes);
  const pinnedFoe = evaluate(pos({ 10: 't1:1+b1:1!' }), 0, foes);
  assert.ok(pinnedFoe > pinnedOwn);

  // A made point beats two blots when nothing threatens either.
  const made = evaluate(pos({ 10: 't1:2' }), 0, foes, safetyOnly);
  const split = evaluate(pos({ 10: 't1:1', 9: 't1:1' }), 0, foes, safetyOnly);
  assert.ok(made > split);
});

test('exposure of lone checkers is exactly the blot part of the evaluation', () => {
  const blotsOnly = { ...DEFAULT_PARAMS, race: 0, made: 0, pin: 0, stuck: 0 };
  const bot = createRandomBot(createRng(3));
  let checked = 0;
  let exposed = 0;
  for (let seed = 1; seed <= 10; seed++) {
    playGame({
      botFor: () => bot,
      seed,
      onTurn: (game) => {
        if (game.over) return;
        const team = game.rules.teamOf[game.history.at(-1).actor];
        const mover = (game.slot + game.rules.S - 1) % game.rules.S;
        const foes = foesAfter(game.rules, game.position, mover, team);
        const e = exposure(game.position, team, foes);
        assert.ok(Math.abs(evaluate(game.position, team, foes, blotsOnly) + e.cost) < 1e-9);
        checked++;
        if (e.expected > 0) exposed++;
      },
    });
  }
  assert.ok(checked > 500);
  assert.ok(exposed > 100, 'many positions had exposed checkers');
});
