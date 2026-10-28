import { enumerateTurns } from '../engine/index.js';

// Chance that two dice can move exactly d pips (single die, sum, or doubles multiples), blocks ignored; out of 36.
const SHOT_COUNTS = { 1: 11, 2: 12, 3: 14, 4: 15, 5: 15, 6: 17, 7: 6, 8: 6, 9: 5, 10: 3, 11: 2, 12: 3, 15: 1, 16: 1, 18: 1, 20: 1, 24: 1 };
const SHOT = new Float64Array(25);
for (const [d, n] of Object.entries(SHOT_COUNTS)) SHOT[d] = n / 36;

export const DEFAULT_PARAMS = Object.freeze({
  race: 1, // per pip of lead
  blotBase: 10, // cost of a pinned checker, in pips
  blotDist: 0.5, // extra cost per pip the pinned checker still has to travel
  secondShot: 0.5, // weight of the enemy seat that moves after our teammate
  made: 2, // reward per safe point (two or more of our checkers)
  pin: 8, // reward/penalty per pinned checker, scaled by its distance
  stuck: 40, // penalty when a seat's pinned checker is all that keeps it from finishing
});

// Chance that the enemy seats `attackers` (in the order they move) can land on point p next; the second one counts less.
export function hitChance(pos, p, attackers, params = DEFAULT_PARAMS) {
  const R = pos.rules;
  let hit = 0;
  attackers.forEach((e, rank) => {
    let best = 0;
    for (let q = 1; q <= R.N; q++) {
      const c = pos.countAt(q, e);
      if (c === 0 || (c === 1 && pos.pinned[q] === e)) continue;
      const d = R.dist[e][q] - R.dist[e][p];
      if (d >= 1 && d <= 24 && SHOT[d] > best) best = SHOT[d];
    }
    hit += (rank === 0 ? 1 : params.secondShot) * best;
  });
  return hit;
}

// Lone checkers of `team` that `attackers` could pin next turn: the expected number of them, and the same weighted by their cost.
export function exposure(pos, team, attackers, params = DEFAULT_PARAMS) {
  const R = pos.rules;
  let expected = 0;
  let cost = 0;
  for (let p = 1; p <= R.N; p++) {
    if (pos.pinned[p] >= 0 || pos.teamCountAt(p, team) !== 1 || pos.teamCountAt(p, 1 - team) !== 0) continue;
    let owner = -1;
    for (const s of R.teamSeats[team]) if (pos.countAt(p, s) > 0) owner = s;
    if (R.startSanctuary && R.startPoint[owner] === p) continue;
    const chance = Math.min(1, hitChance(pos, p, attackers, params));
    expected += chance;
    cost += chance * (params.blotBase + params.blotDist * R.dist[owner][p]);
  }
  return { expected, cost };
}

// Score of `pos` (just after `actor` moved) from the actor's team point of view; `foes` lists enemy seats in the order they move next.
export function evaluate(pos, team, foes, params = DEFAULT_PARAMS) {
  const R = pos.rules;
  const foeTeam = 1 - team;
  let own = 0;
  let enemy = 0;
  for (const s of R.teamSeats[team]) own += pos.pipsLeft(s);
  for (const s of R.teamSeats[foeTeam]) enemy += pos.pipsLeft(s);
  let score = params.race * (enemy - own);

  for (let p = 1; p <= R.N; p++) {
    const ownCount = pos.teamCountAt(p, team);
    const foeCount = pos.teamCountAt(p, foeTeam);
    const pin = pos.pinned[p];
    if (pin >= 0) {
      const pinnedTeam = R.teamOf[pin];
      const weight = params.pin * (1 + R.dist[pin][p] / 24);
      score += pinnedTeam === team ? -weight : weight;
      if (pinnedTeam === team && stuckBehindPin(pos, pin, p)) score -= params.stuck;
      else if (pinnedTeam === foeTeam && stuckBehindPin(pos, pin, p)) score += params.stuck;
      continue;
    }
    if (ownCount >= 2 && foeCount === 0) {
      score += params.made;
    } else if (ownCount === 1 && foeCount === 0) {
      // A lone checker: chance that an enemy seat can land exactly on it next.
      let owner = -1;
      for (const s of R.teamSeats[team]) if (pos.countAt(p, s) > 0) owner = s;
      if (R.startSanctuary && R.startPoint[owner] === p) continue;
      const hit = hitChance(pos, p, foes, params);
      score -= Math.min(1, hit) * (params.blotBase + params.blotDist * R.dist[owner][p]);
    }
  }
  return score;
}

// True when the seat's other checkers are all home or off, so only the pin keeps it from finishing.
export function stuckBehindPin(pos, seat, point) {
  const R = pos.rules;
  for (let p = 1; p <= R.N; p++) {
    if (p !== point && pos.countAt(p, seat) > 0 && R.dist[seat][p] > R.homeSize) return false;
  }
  return true;
}

// Enemy seats in the order they move after the seat in turn slot `slot` (finished seats are skipped).
export function foesAfter(rules, position, slot, team) {
  const foes = [];
  for (let k = 1; k <= rules.S; k++) {
    const seat = rules.turnOrder[(slot + k) % rules.S];
    if (rules.teamOf[seat] !== team && !position.isFinished(seat) && !foes.includes(seat)) foes.push(seat);
  }
  return foes;
}

export function createHeuristicBot(rng, params = DEFAULT_PARAMS) {
  return {
    name: 'heuristic',
    chooseTurn(game) {
      const actor = game.actor;
      const team = game.rules.teamOf[actor];
      const foes = foesAfter(game.rules, game.position, game.slot, team);
      const turns = enumerateTurns(game.position, actor, game.dice, { limits: game.limits, withPositions: true });
      let best = [];
      let bestScore = -Infinity;
      for (const turn of turns) {
        const score = evaluate(turn.after, team, foes, params);
        if (score > bestScore + 1e-9) {
          bestScore = score;
          best = [turn];
        } else if (Math.abs(score - bestScore) <= 1e-9) {
          best.push(turn);
        }
      }
      return best[rng.int(best.length)].steps;
    },
  };
}
