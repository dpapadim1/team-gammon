// Board geometry in SVG units. Points keep their standard numbers; `flipped` mirrors the board top to bottom,
// which puts the viewer's home board at the bottom right for the Bottom team as well.
export const B = Object.freeze({
  frame: 20,
  pointW: 64,
  barW: 44,
  triH: 272,
  gap: 48,
  checkerR: 26,
  trayGap: 12,
  trayW: 90,
});

export const BOARD_W = B.frame * 2 + B.pointW * 12 + B.barW;
export const BOARD_H = B.frame * 2 + B.triH * 2 + B.gap;
export const VIEW_W = BOARD_W + B.trayGap + B.trayW + 12;
export const VIEW_H = BOARD_H;
export const TRAY_X = BOARD_W + B.trayGap;
export const BAR_X = B.frame + 6 * B.pointW;

export function pointGeom(p, flipped = false) {
  const q = flipped ? 25 - p : p;
  const top = q >= 13;
  const col = top ? q - 13 : 12 - q;
  const x = B.frame + col * B.pointW + (col >= 6 ? B.barW : 0);
  const baseY = top ? B.frame : BOARD_H - B.frame;
  const dir = top ? 1 : -1;
  return { p, x, cx: x + B.pointW / 2, baseY, dir, top, col, tipY: baseY + dir * B.triH };
}

export function trianglePoints(g) {
  return `${g.x},${g.baseY} ${g.x + B.pointW},${g.baseY} ${g.cx},${g.tipY}`;
}

// Centres of `n` checkers from the base of the point towards the tip; tall stacks overlap to stay inside the triangle.
export function stackCenters(g, n) {
  const first = g.baseY + g.dir * (B.checkerR + 3);
  const room = B.triH - 2 * B.checkerR - 6;
  const step = n <= 1 ? 0 : Math.min(2 * B.checkerR + 1, room / (n - 1));
  return Array.from({ length: n }, (_, i) => ({ cx: g.cx, cy: first + g.dir * i * step }));
}

// Where the arrow of a move starts or ends on a point.
export function anchor(p, flipped = false) {
  const g = pointGeom(p, flipped);
  return { x: g.cx, y: g.baseY + g.dir * B.triH * 0.42 };
}

// Tray of borne-off checkers: two halves of two seat slots each; the viewer's team is always in the bottom half.
const HALF_H = (BOARD_H - 2 * B.frame - 8) / 2;
const SLOT_H = HALF_H / 2;

export function traySlot(half, index) {
  const y = half === 'top' ? B.frame + index * SLOT_H : B.frame + HALF_H + 8 + index * SLOT_H;
  return { x: TRAY_X + 10, y, w: B.trayW - 20, h: SLOT_H };
}

export function trayHalf(half) {
  return { y: half === 'top' ? B.frame : B.frame + HALF_H + 8, h: HALF_H };
}

export function trayAnchor(half) {
  const h = trayHalf(half);
  return { x: TRAY_X + B.trayW / 2, y: h.y + h.h / 2 };
}
