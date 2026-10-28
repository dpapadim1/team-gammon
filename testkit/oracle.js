// Deliberately naive reference implementation used only to cross-check the engine.
// Points hold ordered stacks (bottom to top); pins are derived from the stack structure, never stored.

export function fromPosition(position) {
  const R = position.rules;
  const stacks = Array.from({ length: R.N + 1 }, () => []);
  for (let p = 1; p <= R.N; p++) {
    const pin = position.pinned[p];
    if (pin >= 0) stacks[p].push(pin);
    for (let s = 0; s < R.S; s++) {
      const n = position.counts[p * R.S + s] - (pin === s ? 1 : 0);
      for (let i = 0; i < n; i++) stacks[p].push(s);
    }
  }
  return { rules: R, stacks, off: Array.from(position.off) };
}

const seatCfg = (st, s) => st.rules.variant.seats[s];
const teamOf = (st, s) => seatCfg(st, s).team;
const distOf = (st, s, p) => (seatCfg(st, s).dir < 0 ? p : st.rules.N + 1 - p);
const pointFor = (st, s, r) => (seatCfg(st, s).dir < 0 ? r : st.rules.N + 1 - r);
const isMixed = (st, stack) => new Set(stack.map((x) => teamOf(st, x))).size > 1;

function movable(st, s, p) {
  const stack = st.stacks[p];
  const mixed = isMixed(st, stack);
  return stack.some((x, i) => x === s && !(mixed && i === 0));
}

function canLand(st, s, q) {
  const stack = st.stacks[q];
  if (stack.length === 0) return true;
  const team = teamOf(st, s);
  const teams = new Set(stack.map((x) => teamOf(st, x)));
  if (teams.size === 1) {
    if (teams.has(team)) return true;
    if (stack.length !== 1) return false;
    return !(st.rules.variant.startSanctuary && seatCfg(st, stack[0]).start === q);
  }
  return teamOf(st, stack[stack.length - 1]) === team;
}

function checkersOf(st, s) {
  const list = [];
  for (let p = 1; p <= st.rules.N; p++) for (const x of st.stacks[p]) if (x === s) list.push(p);
  return list;
}

export function stepsFor(st, s, die) {
  const R = st.rules;
  const out = [];
  for (let p = 1; p <= R.N; p++) {
    if (!movable(st, s, p)) continue;
    const r = distOf(st, s, p);
    const nr = r - die;
    if (nr >= 1) {
      const q = pointFor(st, s, nr);
      if (canLand(st, s, q)) out.push({ from: p, to: q });
    } else {
      const mine = checkersOf(st, s);
      const allHome = mine.every((x) => distOf(st, s, x) <= R.homeSize);
      const nothingFarther = mine.every((x) => distOf(st, s, x) <= r);
      if (allHome && (nr === 0 || nothingFarther)) out.push({ from: p, to: 0 });
    }
  }
  return out;
}

export function applyStep(st, s, from, die) {
  const opt = stepsFor(st, s, die).find((o) => o.from === from);
  if (!opt) throw new Error('oracle: illegal step');
  const stacks = st.stacks.slice();
  const src = stacks[from].slice();
  const mixed = isMixed(st, src);
  let idx = -1;
  for (let i = src.length - 1; i >= (mixed ? 1 : 0); i--) {
    if (src[i] === s) {
      idx = i;
      break;
    }
  }
  src.splice(idx, 1);
  stacks[from] = src;
  const off = st.off.slice();
  if (opt.to === 0) {
    off[s]++;
  } else {
    stacks[opt.to] = [...stacks[opt.to], s];
  }
  return { rules: st.rules, stacks, off };
}

export function canonical(st) {
  const R = st.rules;
  const parts = [];
  for (let p = 1; p <= R.N; p++) {
    const stack = st.stacks[p];
    if (stack.length === 0) {
      parts.push('.');
      continue;
    }
    const pinned = isMixed(st, stack) ? stack[0] : -1;
    const tokens = [];
    for (let s = 0; s < R.S; s++) {
      const n = stack.filter((x) => x === s).length;
      if (n > 0) tokens.push(`${R.seatIds[s]}:${n}${s === pinned ? '!' : ''}`);
    }
    parts.push(tokens.join('+'));
  }
  return `${parts.join('/')} ${st.off.join(',')}`;
}

// Every legal full turn as an ordered step sequence plus its final state.
export function legalSequences(st, s, dice) {
  const orders = dice[0] === dice[1]
    ? [[dice[0], dice[0], dice[0], dice[0]]]
    : [[dice[0], dice[1]], [dice[1], dice[0]]];
  const found = [];
  const walk = (state, order, i, taken) => {
    const options = i < order.length ? stepsFor(state, s, order[i]) : [];
    if (options.length === 0) {
      found.push({ steps: taken, state });
      return;
    }
    for (const o of options) {
      walk(applyStep(state, s, o.from, order[i]), order, i + 1, [...taken, { from: o.from, die: order[i] }]);
    }
  };
  for (const order of orders) walk(st, order, 0, []);
  const longest = Math.max(...found.map((f) => f.steps.length));
  let legal = found.filter((f) => f.steps.length === longest);
  if (dice[0] !== dice[1] && longest === 1) {
    const higher = Math.max(dice[0], dice[1]);
    const withHigher = legal.filter((f) => f.steps[0].die === higher);
    if (withHigher.length > 0) legal = withHigher;
  }
  return { target: longest, legal };
}

export function nextStepKeys(legal, prefix) {
  const keys = new Set();
  for (const f of legal) {
    if (f.steps.length <= prefix.length) continue;
    if (prefix.every((st, i) => st.from === f.steps[i].from && st.die === f.steps[i].die)) {
      keys.add(`${f.steps[prefix.length].from}:${f.steps[prefix.length].die}`);
    }
  }
  return keys;
}
