import { s } from './dom.js';
import { B } from './geometry.js';
import { SEAT_STYLE, seatStyle } from './seats.js';

function marker(id, color) {
  return s('marker', { id, viewBox: '0 0 10 10', refX: 7, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto' },
    s('path', { d: 'M0,0 L10,5 L0,10 z', fill: color }));
}

function defs() {
  return s('defs', null,
    Object.entries(SEAT_STYLE).map(([id, st]) => s('radialGradient', { id: `tg-${id}`, cx: '35%', cy: '30%', r: '75%' },
      s('stop', { offset: '0%', 'stop-color': st.light }),
      s('stop', { offset: '58%', 'stop-color': st.mid }),
      s('stop', { offset: '100%', 'stop-color': st.dark }))),
    marker('tg-arrow-last', '#e6edf5'),
    marker('tg-arrow-hint', '#6fe08a'));
}

function curve(a) {
  const dx = a.to.x - a.from.x;
  const dy = a.to.y - a.from.y;
  const len = Math.hypot(dx, dy) || 1;
  const bend = Math.min(46, len * 0.2);
  const mx = (a.from.x + a.to.x) / 2 - (dy / len) * bend;
  const my = (a.from.y + a.to.y) / 2 + (dx / len) * bend;
  return {
    d: `M${a.from.x},${a.from.y} Q${mx},${my} ${a.to.x},${a.to.y}`,
    mid: { x: 0.25 * a.from.x + 0.5 * mx + 0.25 * a.to.x, y: 0.25 * a.from.y + 0.5 * my + 0.25 * a.to.y },
  };
}

function arrow(a, kind) {
  const { d, mid } = curve(a);
  return s('g', { class: `arrow ${kind}` },
    s('path', { d, class: 'arrow-line', 'marker-end': `url(#tg-arrow-${kind})` }),
    s('circle', { cx: mid.x, cy: mid.y, r: 11, class: 'arrow-die-bg' }),
    s('text', { x: mid.x, y: mid.y + 4.5, class: 'arrow-die', 'text-anchor': 'middle' }, a.die));
}

function checker(c) {
  const st = seatStyle(c.seat);
  return s('g', { class: `checker${c.movable ? ' movable' : ''}${c.pinned ? ' pinned' : ''}` },
    c.movable ? s('circle', { cx: c.cx, cy: c.cy, r: c.r + 5, class: 'movable-ring' }) : null,
    s('circle', { cx: c.cx, cy: c.cy, r: c.r, fill: `url(#tg-${c.seat})`, stroke: st.dark, 'stroke-width': 2 }),
    s('circle', { cx: c.cx, cy: c.cy, r: c.r * 0.66, fill: 'none', stroke: st.light, 'stroke-opacity': 0.45, 'stroke-width': 1.5 }),
    s('text', { x: c.cx, y: c.cy + 6.5, class: 'numeral', 'text-anchor': 'middle', fill: st.ink }, c.numeral),
    c.pinned ? s('circle', { cx: c.cx, cy: c.cy, r: c.r + 3, class: 'pin-ring' }) : null);
}

// Draws a scene from scene.js. Handlers are optional: { onPoint(p), onOff(), onBackground() }.
export function renderBoard(scene, handlers = {}, label = 'Game board') {
  const { board, tray } = scene;
  const inner = { x: board.frame, y: board.frame, w: board.w - 2 * board.frame, h: board.h - 2 * board.frame };
  const svg = s('svg', { viewBox: `0 0 ${scene.width} ${scene.height}`, class: 'board', role: 'group', 'aria-label': label });
  svg.append(defs());
  svg.append(
    s('rect', { class: 'board-frame', x: 0, y: 0, width: board.w, height: board.h, rx: 12 }),
    s('rect', { class: 'board-field', x: inner.x, y: inner.y, width: inner.w, height: inner.h }),
  );

  // Home boards are always on the right: yours at the bottom, the opponents' at the top.
  const homeW = 6 * B.pointW;
  const homeX = board.barX + board.barW;
  svg.append(
    s('rect', { class: 'home mine', x: homeX, y: inner.y + inner.h - B.triH, width: homeW, height: B.triH }),
    s('rect', { class: 'home theirs', x: homeX, y: inner.y, width: homeW, height: B.triH }),
    s('rect', { class: 'board-bar', x: board.barX, y: inner.y, width: board.barW, height: inner.h }),
    s('text', { class: 'home-label', x: homeX + homeW / 2, y: board.h / 2 - 3, 'text-anchor': 'middle' }, 'Opponents\u2019 home'),
    s('text', { class: 'home-label', x: homeX + homeW / 2, y: board.h / 2 + 15, 'text-anchor': 'middle' }, 'Your home'),
  );

  for (const p of scene.points) {
    const cls = ['point', p.shade, p.movable ? 'movable' : '', p.selected ? 'selected' : '', p.target !== null ? 'target' : '', p.last ? `last-${p.last}` : ''];
    svg.append(
      s('polygon', { points: p.polygon, class: cls.filter(Boolean).join(' ') }),
      s('text', { class: 'point-label', x: p.label.x, y: p.label.y, 'text-anchor': 'middle' }, p.label.text),
    );
  }

  const offActive = tray.offTarget !== null;
  for (const half of tray.halves) {
    svg.append(s('rect', { class: `tray-half${half.half === 'bottom' && offActive ? ' off-target' : ''}`, x: tray.x + 4, y: half.y, width: tray.w - 8, height: half.h, rx: 6 }));
  }
  for (const slot of tray.slots) {
    const st = seatStyle(slot.seat);
    svg.append(s('text', { class: 'tray-label', x: slot.label.x, y: slot.label.y, 'text-anchor': 'middle' }, `${st.name} ${slot.seat.slice(1)}`));
    for (const bar of slot.bars) {
      svg.append(s('rect', { class: bar.filled ? 'tray-bar filled' : 'tray-bar', x: bar.x, y: bar.y, width: bar.w, height: bar.h, rx: 3, style: bar.filled ? `fill:${st.mid};stroke:${st.dark}` : null }));
    }
  }

  for (const c of scene.checkers) svg.append(checker(c));
  for (const b of scene.badges) {
    svg.append(s('g', { class: 'badge' },
      s('rect', { x: b.cx - 19, y: b.cy - 9, width: 38, height: 18, rx: 9 }),
      s('text', { x: b.cx, y: b.cy + 4.5, 'text-anchor': 'middle' }, `\u00d7${b.n}`)));
  }

  for (const a of scene.arrows.last) svg.append(arrow(a, 'last'));
  for (const group of scene.arrows.suggest) for (const a of group.arrows) svg.append(arrow(a, 'hint'));

  for (const m of scene.markers) {
    svg.append(s('g', { class: 'ghost' },
      s('circle', { cx: m.cx, cy: m.cy, r: m.r - 2 }),
      s('text', { x: m.cx, y: m.cy + 6, 'text-anchor': 'middle' }, m.die)));
  }
  if (offActive) {
    const half = tray.halves.find((h) => h.half === 'bottom');
    svg.append(s('g', { class: 'ghost off' },
      s('text', { x: tray.x + tray.w / 2, y: half.y + half.h - 10, 'text-anchor': 'middle' }, `off ${tray.offTarget}`)));
  }

  if (handlers.onPoint || handlers.onOff) {
    for (const p of scene.points) {
      const active = p.movable || p.target !== null;
      svg.append(s('rect', {
        class: `hit${active ? ' active' : ''}`,
        x: p.x, y: p.y, width: p.w, height: p.h,
        'data-point': p.p,
        tabindex: active ? 0 : null,
        role: active ? 'button' : null,
        'aria-label': active ? `Point ${p.p}${p.target !== null ? `, move here with ${p.target}` : ''}` : null,
      }));
    }
    const bottom = tray.halves.find((h) => h.half === 'bottom');
    svg.append(s('rect', {
      class: `hit${offActive ? ' active' : ''}`,
      x: tray.x + 4, y: bottom.y, width: tray.w - 8, height: bottom.h,
      'data-off': 1,
      tabindex: offActive ? 0 : null,
      role: offActive ? 'button' : null,
      'aria-label': offActive ? `Bear off with ${tray.offTarget}` : null,
    }));
    const activate = (el) => {
      if (el.dataset.off) handlers.onOff?.();
      else handlers.onPoint?.(Number(el.dataset.point));
    };
    svg.addEventListener('click', (e) => {
      const el = e.target.closest?.('[data-point],[data-off]');
      if (el) activate(el);
      else handlers.onBackground?.();
    });
    svg.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const el = e.target.closest?.('[data-point],[data-off]');
      if (!el) return;
      e.preventDefault();
      activate(el);
    });
  }
  return svg;
}

const PIPS = {
  1: [[20, 20]],
  2: [[11, 11], [29, 29]],
  3: [[11, 11], [20, 20], [29, 29]],
  4: [[11, 11], [29, 11], [11, 29], [29, 29]],
  5: [[11, 11], [29, 11], [20, 20], [11, 29], [29, 29]],
  6: [[11, 11], [29, 11], [11, 20], [29, 20], [11, 29], [29, 29]],
};

export function dieElement(value, used = false) {
  return s('svg', { viewBox: '0 0 40 40', class: `die${used ? ' used' : ''}`, role: 'img', 'aria-label': `Die showing ${value}${used ? ', already used' : ''}` },
    s('rect', { x: 1.5, y: 1.5, width: 37, height: 37, rx: 8 }),
    PIPS[value].map(([x, y]) => s('circle', { cx: x, cy: y, r: 3.4 })));
}

// A single checker for seat cards and legends.
export function checkerIcon(seatId, size = 28) {
  const st = seatStyle(seatId);
  return s('svg', { viewBox: '0 0 40 40', width: size, height: size, class: 'checker-icon', 'aria-hidden': 'true' },
    s('defs', null, s('radialGradient', { id: `ti-${seatId}`, cx: '35%', cy: '30%', r: '75%' },
      s('stop', { offset: '0%', 'stop-color': st.light }), s('stop', { offset: '58%', 'stop-color': st.mid }), s('stop', { offset: '100%', 'stop-color': st.dark }))),
    s('circle', { cx: 20, cy: 20, r: 18, fill: `url(#ti-${seatId})`, stroke: st.dark, 'stroke-width': 2 }),
    s('circle', { cx: 20, cy: 20, r: 12, fill: 'none', stroke: st.light, 'stroke-opacity': 0.45, 'stroke-width': 1.5 }),
    s('text', { x: 20, y: 26, 'text-anchor': 'middle', 'font-size': 18, 'font-weight': 700, fill: st.ink }, seatId.slice(1)));
}
