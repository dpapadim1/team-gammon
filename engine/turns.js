import { BLOCKED } from './position.js';

export function diceList(dice) {
  const [a, b] = dice;
  return a === b ? [a, a, a, a] : [a, b];
}

export function normalizeSteps(steps) {
  if (!Array.isArray(steps)) throw new TypeError('steps must be an array');
  return steps.map((st) => {
    const from = Array.isArray(st) ? st[0] : st?.from;
    const die = Array.isArray(st) ? st[1] : st?.die;
    if (!Number.isInteger(from) || !Number.isInteger(die)) throw new TypeError('each step needs integer from and die');
    return { from, die };
  });
}

export function stepsToWire(steps) {
  return steps.map((st) => [st.from, st.die]);
}

function removeOne(sortedDice, die) {
  const rest = sortedDice.slice();
  rest.splice(rest.indexOf(die), 1);
  return rest;
}

// Most dice that can be played from `pos`, in any order (`pos` is restored before returning).
export function maxPlayable(pos, s, dice) {
  const memo = new Map();
  const go = (rem) => {
    if (rem.length === 0) return 0;
    const remKey = rem.join('');
    let byPosition = memo.get(remKey);
    if (!byPosition) {
      byPosition = new Map();
      memo.set(remKey, byPosition);
    }
    const key = pos.key();
    const hit = byPosition.get(key);
    if (hit !== undefined) return hit;
    let best = 0;
    for (let i = 0; i < rem.length && best < rem.length; i++) {
      const die = rem[i];
      if (i > 0 && rem[i - 1] === die) continue;
      const rest = removeOne(rem, die);
      for (const from of pos.legalFroms(s, die)) {
        const rec = pos.applyStep(s, from, die);
        const n = 1 + go(rest);
        pos.undoStep(rec);
        if (n > best) best = n;
        if (best === rem.length) break;
      }
    }
    byPosition.set(key, best);
    return best;
  };
  return go(dice.slice().sort((a, b) => a - b));
}

// `target` is how many dice must be played; `forcedDie` is set when only one die may be played and the rules pick it.
export function turnLimits(pos, s, dice) {
  const target = maxPlayable(pos, s, diceList(dice));
  let forcedDie = null;
  if (target === 1 && dice[0] !== dice[1]) {
    const hi = Math.max(dice[0], dice[1]);
    const lo = Math.min(dice[0], dice[1]);
    forcedDie = pos.legalFroms(s, hi).length > 0 ? hi : lo;
  }
  return { target, forcedDie };
}

// Steps that keep a full legal turn reachable; `remaining` are the dice not yet used.
export function legalNextSteps(pos, s, remaining, played, limits) {
  const need = limits.target - played;
  if (need <= 0) return [];
  const out = [];
  const sorted = remaining.slice().sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    const die = sorted[i];
    if (i > 0 && sorted[i - 1] === die) continue;
    if (limits.forcedDie !== null && die !== limits.forcedDie) continue;
    const rest = removeOne(sorted, die);
    for (const from of pos.legalFroms(s, die)) {
      const to = pos.stepTarget(s, from, die);
      let ok = true;
      if (need > 1) {
        const rec = pos.applyStep(s, from, die, to);
        ok = maxPlayable(pos, s, rest) >= need - 1;
        pos.undoStep(rec);
      }
      if (ok) out.push({ from, die, to });
    }
  }
  return out;
}

// All legal full turns, one per distinct resulting position. A pass is a single turn with no steps.
export function enumerateTurns(pos, s, dice, { withPositions = false, limits = turnLimits(pos, s, dice) } = {}) {
  const { target, forcedDie } = limits;
  if (target === 0) {
    return [{ steps: [], key: pos.key(), after: withPositions ? pos.clone() : undefined }];
  }
  const orders = dice[0] === dice[1] ? [diceList(dice)] : [[dice[0], dice[1]], [dice[1], dice[0]]];
  const work = pos.clone();
  const seenFinal = new Set();
  const turns = [];
  const steps = [];

  for (const order of orders) {
    if (forcedDie !== null && order[0] !== forcedDie) continue;
    const visited = Array.from({ length: target + 1 }, () => new Set());
    const dfs = (depth) => {
      if (depth === target) {
        const key = work.key();
        if (!seenFinal.has(key)) {
          seenFinal.add(key);
          turns.push({ steps: steps.slice(), key, after: withPositions ? work.clone() : undefined });
        }
        return;
      }
      const die = order[depth];
      for (const from of work.legalFroms(s, die)) {
        const to = work.stepTarget(s, from, die);
        const rec = work.applyStep(s, from, die, to);
        const key = work.key();
        if (!visited[depth + 1].has(key)) {
          visited[depth + 1].add(key);
          steps.push({ from, die, to });
          dfs(depth + 1);
          steps.pop();
        }
        work.undoStep(rec);
      }
    };
    dfs(0);
  }
  return turns;
}

// `steps` must already be normalised ({from, die}). Returns the resulting position on success.
export function validateTurn(pos, s, dice, steps) {
  const limits = turnLimits(pos, s, dice);
  const work = pos.clone();
  const remaining = diceList(dice);
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    const match = legalNextSteps(work, s, remaining, i, limits).find((x) => x.from === st.from && x.die === st.die);
    if (!match) return { ok: false, error: `step ${i + 1} (point ${st.from}, die ${st.die}) is not legal` };
    work.applyStep(s, st.from, st.die, match.to);
    remaining.splice(remaining.indexOf(st.die), 1);
  }
  if (steps.length !== limits.target) {
    return { ok: false, error: `${limits.target} die/dice must be played, got ${steps.length}` };
  }
  return { ok: true, limits, after: work };
}

export function applyTurn(pos, s, steps) {
  const records = [];
  for (const st of steps) {
    const to = pos.stepTarget(s, st.from, st.die);
    if (to === BLOCKED) throw new Error(`illegal step from ${st.from} with ${st.die}`);
    records.push(pos.applyStep(s, st.from, st.die, to));
  }
  return records;
}
