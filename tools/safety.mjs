// Opening safety per layout: node tools/safety.mjs [--games 400] [--seed 1]
// For every seat and every roll: can the mover leave no hittable lone checker? How exposed are the first turns of real games?
import { parseArgs } from 'node:util';
import { Game, VARIANTS, compileVariant, createRng, enumerateTurns } from '../engine/index.js';
import { createHeuristicBot, evaluate, foesAfter } from '../bots/heuristic.js';
import { playGame } from '../bots/arena.js';

const { values } = parseArgs({ options: { games: { type: 'string', default: '400' }, seed: { type: 'string', default: '1' } } });
const games = Number(values.games);
const seed = Number(values.seed);

// With every other term off, evaluate() is minus the expected number of lone checkers the next enemy seats can pin.
const RISK = { race: 0, blotBase: 1, blotDist: 0, secondShot: 0.5, made: 0, pin: 0, stuck: 0 };
const f = (x, d = 2) => x.toFixed(d);

function openingRows(variant) {
  const rules = compileVariant(variant);
  const rows = [];
  for (let seat = 0; seat < rules.S; seat++) {
    let safe = 0;
    let risk = 0;
    let passes = 0;
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) {
        const game = new Game(variant, { firstSlot: rules.turnOrder.indexOf(seat) });
        if (game.roll([a, b]).passed) {
          safe++;
          passes++;
          continue;
        }
        const team = rules.teamOf[seat];
        const foes = foesAfter(rules, game.position, game.slot, team);
        const turns = enumerateTurns(game.position, seat, game.dice, { limits: game.limits, withPositions: true });
        const best = Math.min(...turns.map((t) => -evaluate(t.after, team, foes, RISK)));
        if (best < 1e-9) safe++;
        risk += best;
      }
    }
    rows.push({ seat: rules.seatIds[seat], safe: (100 * safe) / 36, risk: risk / 36, passes: (100 * passes) / 36 });
  }
  return rows;
}

function earlyExposure(variant) {
  const rules = compileVariant(variant);
  const rng = createRng(seed * 31 + 7);
  const bots = Array.from({ length: rules.S }, () => createHeuristicBot(rng));
  let sum = 0;
  let n = 0;
  for (let i = 0; i < games; i++) {
    playGame({
      variant,
      botFor: (s) => bots[s],
      seed: seed + i,
      maxTurns: 8,
      onTurn(game) {
        const last = game.history.at(-1);
        const team = rules.teamOf[last.actor];
        sum += -evaluate(game.position, team, foesAfter(rules, game.position, last.slot, team), RISK);
        n++;
      },
    });
  }
  return sum / n;
}

for (const variant of Object.values(VARIANTS)) {
  console.log(`\n${variant.name}`);
  console.log('  opening seat   fully safe rolls   mean best-case exposure   rolls that cannot move at all');
  for (const r of openingRows(variant)) {
    console.log(`  ${r.seat.padEnd(12)} ${`${f(r.safe, 1)}%`.padStart(14)} ${f(r.risk).padStart(20)} ${`${f(r.passes, 1)}%`.padStart(30)}`);
  }
  console.log(`  mean exposure left after each of the first 8 turns of heuristic games: ${f(earlyExposure(variant))}`);
}
