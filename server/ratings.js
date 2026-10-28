// Team Elo. A team is as strong as the mean of its seats and every registered player moves by their own K.
// Bots keep a fixed rating and guests count as new players; neither is updated.
export const START_RATING = 1200;
export const PROVISIONAL_GAMES = 20;
export const MIN_RATED_TURNS = 8;

const RATED_REASONS = new Set(['bearoff', 'timeout', 'resign', 'deadlock']);

// Elo of each bot level, chained from the arena win rate of every level against the one below
// (tools/arena.mjs, 1000+ games each): 70.0%, 67.8%, 72.0%, 67.9%, 63.9%, 59.5%, 58.5%, 68.5%.
export const BOT_RATINGS = Object.freeze({ 1: 800, 2: 947, 3: 1077, 4: 1241, 5: 1371, 6: 1470, 7: 1537, 8: 1596, 9: 1731 });

export function expectedScore(own, other) {
  return 1 / (1 + 10 ** ((other - own) / 400));
}

export function kFactor(games, rating) {
  if (games < PROVISIONAL_GAMES) return 40;
  return rating < 1800 ? 24 : 16;
}

// Games that end abandoned or by an error, and very short ones, cannot be used to feed ratings.
export function isRated(reason, turns) {
  return RATED_REASONS.has(reason) && turns >= MIN_RATED_TURNS;
}

const mean = (values) => values.reduce((sum, x) => sum + x, 0) / values.length;

// `entries` holds all four seats as {seat, team, rating}; registered players also carry {userId, games}.
// `winnerTeam` is 0, 1 or -1 for a draw. Returns one change per registered player.
export function rateGame(entries, winnerTeam) {
  const strength = [0, 1].map((team) => mean(entries.filter((e) => e.team === team).map((e) => e.rating)));
  return entries.filter((e) => e.userId !== undefined).map((e) => {
    const score = winnerTeam === -1 ? 0.5 : winnerTeam === e.team ? 1 : 0;
    const expected = expectedScore(strength[e.team], strength[1 - e.team]);
    return {
      userId: e.userId,
      seat: e.seat,
      before: e.rating,
      after: e.rating + kFactor(e.games, e.rating) * (score - expected),
      won: score === 1,
    };
  });
}
