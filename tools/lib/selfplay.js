import { QUADRANT_PLAKOTO_4P, createRng } from '../../engine/index.js';
import { playGame } from '../../bots/arena.js';
import { createFeatureBuffer, encoderFor } from '../../bots/features.js';
import { createHeuristicBot } from '../../bots/heuristic.js';
import { createNetBot, loadNetFile } from '../../bots/nn.js';
import { createRandomBot } from '../../bots/random.js';
import { ShardBuilder } from './shards.js';

// A bot that plays a random legal turn with probability `epsilon` and otherwise whatever `bot` plays.
export function withEpsilon(bot, rng, epsilon) {
  if (epsilon <= 0) return bot;
  const random = createRandomBot(rng);
  return { name: `${bot.name}+${epsilon}`, chooseTurn: (game) => (rng.float() < epsilon ? random.chooseTurn(game) : bot.chooseTurn(game)) };
}

export function createPolicy({ policy, netPath, epsilon = 0, tau = 0 }, rng) {
  if (policy === 'net') return createNetBot(loadNetFile(netPath), rng, { epsilon, tau });
  if (policy === 'heuristic') return withEpsilon(createHeuristicBot(rng), rng, epsilon);
  if (policy === 'random') return createRandomBot(rng);
  throw new Error(`unknown policy ${policy}`);
}

// Plays the games first, first + step, ... (count of them). The dice and the bots of game g depend only on seed + g,
// so the same games come out however they are shared between workers.
export function playSelfPlay({ policy, netPath, epsilon = 0, tau = 0, seed = 1, first = 0, step = 1, count, variant = QUADRANT_PLAKOTO_4P }) {
  const builder = new ShardBuilder();
  const feat = createFeatureBuffer();
  const stats = { games: 0, unfinished: 0, turns: 0, passes: 0, wins: [0, 0], draws: 0, deadlocks: 0 };
  for (let k = 0; k < count; k++) {
    const gameSeed = seed + first + k * step;
    const bot = createPolicy({ policy, netPath, epsilon, tau }, createRng(Math.imul(gameSeed, 2654435761) ^ 0x85ebca6b));
    const { game } = playGame({
      variant,
      botFor: () => bot,
      seed: gameSeed,
      onTurn: (g) => {
        if (g.over) return;
        const team = g.rules.teamOf[g.history[g.history.length - 1].actor];
        builder.addSample(encoderFor(g.rules).encode(g.position, team, g.slot, feat), team);
      },
    });
    if (!game.over) {
      builder.discardGame();
      stats.unfinished++;
      continue;
    }
    const last = game.history[game.history.length - 1];
    const lastTeam = game.rules.teamOf[last.actor];
    builder.endGame(lastTeam, game.winnerTeam === -1 ? 1 : game.winnerTeam === lastTeam ? 2 : 0);
    stats.games++;
    stats.turns += game.history.length;
    for (const entry of game.history) if (entry.steps.length === 0) stats.passes++;
    if (game.winnerTeam === -1) stats.draws++;
    else stats.wins[game.winnerTeam]++;
    if (game.endReason === 'deadlock') stats.deadlocks++;
  }
  return { parts: builder.parts(), stats };
}

export function mergeStats(list) {
  const total = { games: 0, unfinished: 0, turns: 0, passes: 0, wins: [0, 0], draws: 0, deadlocks: 0 };
  for (const s of list) {
    for (const key of ['games', 'unfinished', 'turns', 'passes', 'draws', 'deadlocks']) total[key] += s[key];
    total.wins[0] += s.wins[0];
    total.wins[1] += s.wins[1];
  }
  return total;
}
