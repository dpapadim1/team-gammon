import * as G from './geometry.js';
import { seatNumeral } from './seats.js';

const OFF = 0;

// Checkers on a point from the base outwards: a pinned checker sits at the base under its pinners.
export function stackOf(position, rules, p) {
  const S = rules.S;
  const pinned = position.pinned[p];
  const stack = [];
  if (pinned >= 0) stack.push({ seat: pinned, pinned: true });
  for (let s = 0; s < S; s++) {
    const n = position.counts[p * S + s] - (s === pinned ? 1 : 0);
    for (let i = 0; i < n; i++) stack.push({ seat: s, pinned: false });
  }
  return stack;
}

function homePoints(rules, team) {
  const seat = rules.teamSeats[team][0];
  const set = new Set();
  for (let p = 1; p <= rules.N; p++) if (rules.dist[seat][p] <= rules.homeSize) set.add(p);
  return set;
}

// Turns a position and the interaction state into plain shapes; render.js draws them and tests inspect them.
// ui: { selected, movable: [point], targets: [{to, die}], actor: seatIndex, last: {steps: [[from, die, to]], team}, suggestions: [{seat, steps: [[from, die, to]]}] }
export function buildScene({ rules, position, viewTeam = 0, ui = {} }) {
  const flipped = viewTeam === 1;
  const movable = new Set(ui.movable ?? []);
  const targets = new Map();
  let offTarget = null;
  for (const t of ui.targets ?? []) {
    if (t.to === OFF) offTarget = t.die;
    else targets.set(t.to, t.die);
  }
  const lastFrom = new Set();
  const lastTo = new Set();
  for (const [from, , to] of ui.last?.steps ?? []) {
    lastFrom.add(from);
    if (to !== OFF) lastTo.add(to);
  }
  const mineHome = homePoints(rules, viewTeam);
  const theirsHome = homePoints(rules, 1 - viewTeam);

  const points = [];
  const checkers = [];
  const badges = [];
  const markers = [];
  for (let p = 1; p <= rules.N; p++) {
    const g = G.pointGeom(p, flipped);
    const stack = stackOf(position, rules, p);
    const centers = G.stackCenters(g, stack.length);
    let lastOwn = stack.length - 1;
    if (ui.actor !== undefined) {
      lastOwn = -1;
      stack.forEach((c, i) => {
        if (c.seat === ui.actor) lastOwn = i;
      });
    }
    stack.forEach((c, i) => {
      const seat = rules.seatIds[c.seat];
      checkers.push({
        id: `${p}:${i}`,
        p,
        seat,
        team: rules.teamOf[c.seat],
        cx: centers[i].cx,
        cy: centers[i].cy,
        r: G.B.checkerR,
        pinned: c.pinned,
        numeral: seatNumeral(seat),
        movable: movable.has(p) && i === lastOwn,
      });
    });
    // Tall stacks overlap, so the count sits in the gap in the middle of the board just beyond the tip of the point.
    if (stack.length > 5) badges.push({ p, cx: g.cx, cy: g.tipY + g.dir * 14, n: stack.length });
    const shade = (g.col + (g.top ? 0 : 1)) % 2 === 0 ? 'dark' : 'light';
    points.push({
      p,
      polygon: G.trianglePoints(g),
      x: g.x,
      y: Math.min(g.baseY, g.tipY),
      w: G.B.pointW,
      h: G.B.triH,
      top: g.top,
      shade,
      label: { x: g.cx, y: g.top ? G.B.frame - 6 : G.BOARD_H - G.B.frame + 15, text: String(p) },
      home: mineHome.has(p) ? 'mine' : theirsHome.has(p) ? 'theirs' : null,
      count: stack.length,
      movable: movable.has(p),
      selected: ui.selected === p,
      target: targets.has(p) ? targets.get(p) : null,
      last: lastFrom.has(p) ? 'from' : lastTo.has(p) ? 'to' : null,
    });
  }
  for (const [to, die] of targets) {
    const n = points[to - 1].count;
    const slot = G.stackCenters(G.pointGeom(to, flipped), n + 1)[n];
    markers.push({ p: to, cx: slot.cx, cy: slot.cy, r: G.B.checkerR, die });
  }

  const slots = [];
  for (let team = 0; team < 2; team++) {
    const half = team === viewTeam ? 'bottom' : 'top';
    rules.teamSeats[team].forEach((seat, index) => {
      const area = G.traySlot(half, index);
      const count = position.off[seat];
      const bars = [];
      for (let i = 0; i < rules.checkersPerSeat; i++) {
        bars.push({ x: area.x, y: area.y + 24 + i * 14, w: area.w, h: 11, filled: i < count });
      }
      slots.push({ seat: rules.seatIds[seat], team, half, label: { x: area.x + area.w / 2, y: area.y + 15 }, count, max: rules.checkersPerSeat, bars });
    });
  }

  const arrowFor = (steps, team) => steps.map(([from, die, to]) => ({
    from: G.anchor(from, flipped),
    to: to === OFF ? G.trayAnchor(team === viewTeam ? 'bottom' : 'top') : G.anchor(to, flipped),
    die,
    off: to === OFF,
  }));
  const arrows = {
    last: ui.last ? arrowFor(ui.last.steps, ui.last.team) : [],
    suggest: (ui.suggestions ?? []).map((s) => ({ seat: s.seat, arrows: arrowFor(s.steps, viewTeam) })),
  };

  return {
    width: G.VIEW_W,
    height: G.VIEW_H,
    flipped,
    board: { w: G.BOARD_W, h: G.BOARD_H, frame: G.B.frame, barX: G.BAR_X, barW: G.B.barW },
    points,
    checkers,
    badges,
    markers,
    tray: { x: G.TRAY_X, w: G.B.trayW, h: G.BOARD_H, halves: [{ half: 'top', ...G.trayHalf('top') }, { half: 'bottom', ...G.trayHalf('bottom') }], slots, offTarget },
    arrows,
  };
}
