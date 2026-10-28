import { compileVariant, createRng } from '../engine/index.js';
import { playGame } from './arena.js';

const EARLY_TURNS = 8;

// Plays `games` games with bots from `makeBots(rng, rules)` (one per seat) and collects balance statistics.
export function runBatch({ variant, games, seed = 1, cycle = 'random', makeBots }) {
  const rules = compileVariant(variant);
  const bots = makeBots(createRng(seed * 7919 + 13), rules);
  const s = {
    variant: variant.id,
    checkers: variant.checkersPerSeat,
    games,
    wins: [0, 0],
    byCycle: { forward: { games: 0, topWins: 0 }, reverse: { games: 0, topWins: 0 } },
    draws: 0,
    deadlocks: 0,
    lengths: [],
    firstMoverWins: 0,
    decided: 0,
    pins: 0,
    earlyPinGames: 0,
    firstPins: [],
    passes: 0,
    transfers: 0,
    deadShapes: new Map(),
    ms: 0,
  };
  const started = Date.now();
  for (let i = 0; i < games; i++) {
    const { game, firstActor, pinTurns, reversed } = playGame({ variant, botFor: (seat) => bots[seat], seed: seed + i, cycle });
    const direction = s.byCycle[reversed ? 'reverse' : 'forward'];
    direction.games++;
    if (game.winnerTeam === 0) direction.topWins++;
    s.lengths.push(game.history.length);
    s.pins += pinTurns.length;
    if (pinTurns.length) s.firstPins.push(pinTurns[0]);
    if (pinTurns.some((t) => t < EARLY_TURNS)) s.earlyPinGames++;
    for (const entry of game.history) {
      if (entry.steps.length === 0) s.passes++;
      if (entry.actor !== game.rules.turnOrder[entry.slot]) s.transfers++;
    }
    if (game.endReason === 'deadlock') {
      s.deadlocks++;
      const shape = [];
      for (let p = 1; p <= rules.N; p++) {
        if (game.position.pinned[p] >= 0) shape.push(`${p}:${rules.seatIds[game.position.pinned[p]]}`);
      }
      const key = shape.join(' ');
      s.deadShapes.set(key, (s.deadShapes.get(key) ?? 0) + 1);
    }
    if (game.winnerTeam === -1) {
      s.draws++;
    } else {
      s.wins[game.winnerTeam]++;
      s.decided++;
      if (rules.teamOf[firstActor] === game.winnerTeam) s.firstMoverWins++;
    }
  }
  s.ms = Date.now() - started;
  return s;
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const pct = (x, n) => (n ? (100 * x) / n : NaN);

export function summarize(s) {
  const sorted = [...s.lengths].sort((a, b) => a - b);
  return {
    variant: s.variant,
    checkers: s.checkers,
    games: s.games,
    topWin: pct(s.wins[0], s.games),
    bottomWin: pct(s.wins[1], s.games),
    topWinForward: pct(s.byCycle.forward.topWins, s.byCycle.forward.games),
    topWinReverse: pct(s.byCycle.reverse.topWins, s.byCycle.reverse.games),
    deadlock: pct(s.deadlocks, s.games),
    firstMover: pct(s.firstMoverWins, s.decided),
    len: mean(s.lengths),
    p10: sorted[Math.floor(sorted.length * 0.1)],
    p90: sorted[Math.floor(sorted.length * 0.9)],
    pins: s.pins / s.games,
    earlyPin: pct(s.earlyPinGames, s.games),
    firstPin: mean(s.firstPins),
    passes: s.passes / s.games,
    transfers: s.transfers / s.games,
    secs: s.ms / 1000,
  };
}

export function formatSummary(r) {
  const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '-');
  return [
    `${r.variant} (${r.checkers}/seat), ${r.games} games in ${f(r.secs)}s`,
    `  wins top/bottom ${f(r.topWin)}% / ${f(r.bottomWin)}%, deadlock draws ${f(r.deadlock)}%, first mover's team ${f(r.firstMover)}% of decided`,
    `  Top wins ${f(r.topWinForward)}% when the cycle is t1,b1,t2,b2 and ${f(r.topWinReverse)}% when reversed`,
    `  length mean ${f(r.len)} (p10 ${r.p10}, p90 ${r.p90}) table turns, passes ${f(r.passes)}/game, idle transfers ${f(r.transfers)}/game`,
    `  pins ${f(r.pins)}/game, first pin at turn ${f(r.firstPin)}, a pin within the first ${EARLY_TURNS} turns in ${f(r.earlyPin)}% of games`,
  ].join('\n');
}
