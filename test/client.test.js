import test from 'node:test';
import assert from 'node:assert/strict';
import { Position } from '../engine/index.js';
import * as G from '../client/js/geometry.js';
import { buildScene, stackOf } from '../client/js/scene.js';
import { TurnBuilder, withTargets } from '../client/js/turn.js';
import { ClockModel } from '../client/js/clocks.js';
import { deriveView, seatStats, teamStats } from '../client/js/viewmodel.js';
import { describeStep, describeTurn, errorMessage, formatClock, levelLabel, resultReason, resultText, rulesFor, seatTitle, signed } from '../client/js/format.js';
import { seatNumeral, seatStyle } from '../client/js/seats.js';
import { B1, B2, T1, T2, pos, rules } from '../testkit/helpers.js';

test('points sit where a backgammon board has them, on both sides of the bar', () => {
  const p24 = G.pointGeom(24);
  assert.deepEqual([p24.top, p24.col, p24.x, p24.baseY, p24.dir], [true, 11, G.B.frame + 11 * G.B.pointW + G.B.barW, G.B.frame, 1]);
  const p1 = G.pointGeom(1);
  assert.deepEqual([p1.top, p1.col, p1.baseY, p1.dir], [false, 11, G.BOARD_H - G.B.frame, -1]);
  assert.equal(p1.x, p24.x, 'points 1 and 24 share the right-hand column');
  assert.equal(G.pointGeom(13).x, G.B.frame);
  assert.equal(G.pointGeom(12).x, G.B.frame);
  assert.equal(G.pointGeom(19).x - G.pointGeom(18).x, G.B.pointW + G.B.barW, 'the bar sits between 18 and 19');
  assert.equal(G.pointGeom(7).x - G.pointGeom(6).x, -(G.B.pointW + G.B.barW), 'and between 6 and 7');
});

test('flipping mirrors the board top to bottom and keeps the columns', () => {
  for (let p = 1; p <= 24; p++) {
    const flipped = G.pointGeom(p, true);
    const mirror = G.pointGeom(25 - p);
    assert.deepEqual([flipped.x, flipped.baseY, flipped.dir], [mirror.x, mirror.baseY, mirror.dir]);
    assert.equal(flipped.top, !G.pointGeom(p).top);
    assert.equal(flipped.col, G.pointGeom(p).col, 'left and right do not swap');
  }
});

test('every triangle and stack fits on the board', () => {
  const seen = new Set();
  for (let p = 1; p <= 24; p++) {
    const g = G.pointGeom(p);
    assert.ok(g.x >= G.B.frame && g.x + G.B.pointW <= G.BOARD_W - G.B.frame);
    seen.add(`${g.x}:${g.top}`);
    for (const n of [1, 5, 6, 16, 32]) {
      const cs = G.stackCenters(g, n);
      assert.equal(cs.length, n);
      for (const c of cs) {
        const far = c.cy + g.dir * G.B.checkerR;
        assert.ok((far - g.baseY) * g.dir <= G.B.triH + 0.001, `n=${n} stays inside the triangle`);
        assert.ok((c.cy - g.baseY) * g.dir >= G.B.checkerR, 'and never crosses the base');
      }
    }
  }
  assert.equal(seen.size, 24, 'all points have distinct places');
  const five = G.stackCenters(G.pointGeom(24), 5);
  assert.ok(five[1].cy - five[0].cy >= 2 * G.B.checkerR, 'up to five checkers do not overlap');
  const twelve = G.stackCenters(G.pointGeom(24), 12);
  assert.ok(twelve[1].cy - twelve[0].cy < 2 * G.B.checkerR, 'taller stacks overlap');
});

test('tray slots stay inside the tray and the halves do not overlap', () => {
  for (const half of ['top', 'bottom']) {
    for (const i of [0, 1]) {
      const s = G.traySlot(half, i);
      assert.ok(s.x >= G.TRAY_X && s.x + s.w <= G.TRAY_X + G.B.trayW);
      assert.ok(s.y >= G.B.frame && s.y + s.h <= G.BOARD_H - G.B.frame);
    }
  }
  const top = G.trayHalf('top');
  const bottom = G.trayHalf('bottom');
  assert.ok(top.y + top.h <= bottom.y);
  assert.ok(G.VIEW_W > G.TRAY_X + G.B.trayW);
});

test('the start position is drawn with 32 checkers on four points', () => {
  const scene = buildScene({ rules, position: Position.initial(rules) });
  assert.equal(scene.points.length, 24);
  assert.equal(scene.checkers.length, 32);
  const byPoint = (p) => scene.checkers.filter((c) => c.p === p);
  assert.deepEqual([24, 18, 1, 7].map((p) => byPoint(p).length), [8, 8, 8, 8]);
  assert.ok(byPoint(24).every((c) => c.seat === 't1' && c.numeral === '1' && !c.pinned));
  assert.ok(byPoint(18).every((c) => c.seat === 't2' && c.numeral === '2'));
  assert.equal(scene.badges.length, 4, 'every start stack is taller than five');
  assert.equal(scene.badges.find((b) => b.p === 24).n, 8);
  const topBadge = scene.badges.find((b) => b.p === 24);
  const bottomBadge = scene.badges.find((b) => b.p === 1);
  assert.ok(topBadge.cy < bottomBadge.cy - 18, 'badges of points 24 and 1 share a column without overlapping');
  assert.ok(topBadge.cy > G.B.frame + G.B.triH && bottomBadge.cy < G.BOARD_H - G.B.frame - G.B.triH, 'they sit in the gap between the rows');
  assert.equal(scene.flipped, false);
  const homes = scene.points.filter((p) => p.home === 'mine').map((p) => p.p);
  assert.deepEqual(homes, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(scene.points.filter((p) => p.home === 'theirs').map((p) => p.p), [19, 20, 21, 22, 23, 24]);
  const light = scene.points.filter((p) => p.shade === 'light').length;
  assert.equal(light, 12, 'triangles alternate in colour');
  assert.equal(new Set(scene.points.filter((p) => p.top).map((p) => p.shade)).size, 2);
});

test('the Bottom team sees the board flipped with its home at the bottom right', () => {
  const normal = buildScene({ rules, position: Position.initial(rules), viewTeam: 0 });
  const flipped = buildScene({ rules, position: Position.initial(rules), viewTeam: 1 });
  assert.equal(flipped.flipped, true);
  const startOf = (scene, p) => scene.checkers.find((c) => c.p === p);
  assert.ok(startOf(normal, 24).cy < G.BOARD_H / 2, 'point 24 is at the top for Top');
  assert.ok(startOf(flipped, 24).cy > G.BOARD_H / 2, 'and at the bottom for Bottom');
  assert.equal(startOf(normal, 24).cx, startOf(flipped, 24).cx);
  assert.deepEqual(flipped.points.filter((p) => p.home === 'mine').map((p) => p.p), [19, 20, 21, 22, 23, 24]);
  const bottomHalf = (scene) => scene.tray.slots.filter((s) => s.half === 'bottom').map((s) => s.seat);
  assert.deepEqual(bottomHalf(normal), ['t1', 't2'], 'the viewer\'s team is in the bottom half of the tray');
  assert.deepEqual(bottomHalf(flipped), ['b1', 'b2']);
});

test('a pinned checker is drawn at the base under its pinners', () => {
  const p = pos({ 7: 't1:2+b1:1!', 3: 'b2:1' }, { t2: 8 });
  const stack = stackOf(p, rules, 7);
  assert.deepEqual(stack.map((c) => [rules.seatIds[c.seat], c.pinned]), [['b1', true], ['t1', false], ['t1', false]]);
  const scene = buildScene({ rules, position: p });
  const drawn = scene.checkers.filter((c) => c.p === 7);
  assert.equal(drawn[0].seat, 'b1');
  assert.equal(drawn[0].pinned, true);
  assert.equal(drawn.filter((c) => c.pinned).length, 1);
  const g = G.pointGeom(7);
  assert.ok(Math.abs(drawn[0].cy - (g.baseY + g.dir * (G.B.checkerR + 3))) < 0.001, 'at the base');
});

test('interaction hints: movable checkers, targets, last moves and suggestions', () => {
  const position = Position.initial(rules);
  const scene = buildScene({
    rules,
    position,
    ui: { actor: T1, selected: 24, movable: [24], targets: [{ to: 18, die: 6 }, { to: 0, die: 3 }], last: { steps: [[1, 4, 5], [5, 2, 0]], team: 1 }, suggestions: [{ seat: 't2', steps: [[24, 6, 18]] }] },
  });
  const p24 = scene.points.find((p) => p.p === 24);
  assert.deepEqual([p24.movable, p24.selected, p24.target], [true, true, null]);
  assert.equal(scene.points.find((p) => p.p === 18).target, 6);
  assert.equal(scene.tray.offTarget, 3);
  const flagged = scene.checkers.filter((c) => c.movable);
  assert.equal(flagged.length, 1, 'only the top checker of the movable point is flagged');
  assert.equal(flagged[0].p, 24);
  assert.equal(flagged[0].id, '24:7');
  assert.equal(scene.markers.length, 1);
  assert.equal(scene.markers[0].p, 18);
  const g18 = G.pointGeom(18);
  assert.ok(Math.abs(scene.markers[0].cy - G.stackCenters(g18, 9)[8].cy) < 0.001, 'the marker sits where the next checker would land');
  assert.equal(scene.points.find((p) => p.p === 1).last, 'from');
  assert.equal(scene.points.find((p) => p.p === 5).last, 'from');
  assert.equal(scene.arrows.last.length, 2);
  assert.equal(scene.arrows.last[1].off, true);
  assert.equal(scene.arrows.last[1].to.y < G.BOARD_H / 2, true, 'Bottom bears off into the top half of the tray as seen by Top');
  assert.equal(scene.arrows.suggest[0].seat, 't2');
  assert.equal(scene.arrows.suggest[0].arrows.length, 1);
});

test('the tray shows how many checkers each seat has borne off', () => {
  const p = pos({ 24: 't1:1', 1: 'b1:1' }, { t1: 3, t2: 8, b2: 2 });
  const scene = buildScene({ rules, position: p });
  const slot = (id) => scene.tray.slots.find((s) => s.seat === id);
  assert.deepEqual([slot('t1').count, slot('t2').count, slot('b1').count, slot('b2').count], [3, 8, 0, 2]);
  assert.equal(slot('t1').bars.length, 8);
  assert.equal(slot('t1').bars.filter((b) => b.filled).length, 3);
  assert.equal(slot('t2').bars.every((b) => b.filled), true);
});

test('turn builder: movable points, destinations, undo and completion', () => {
  const tb = new TurnBuilder(Position.initial(rules), T1, [6, 1]);
  assert.equal(tb.target, 2);
  assert.deepEqual(tb.movablePoints(), [24]);
  assert.deepEqual(tb.targetsFrom(24).sort((a, b) => a.die - b.die), [{ to: 23, die: 1 }, { to: 18, die: 6 }]);
  assert.deepEqual(tb.targetsFrom(18), []);
  assert.equal(tb.stepFor(24, 18).die, 6);
  assert.equal(tb.stepFor(24, 17), null);

  tb.play(tb.stepFor(24, 18));
  assert.equal(tb.done, false);
  assert.deepEqual(tb.movablePoints().sort((a, b) => b - a), [24, 18], 'the moved checker can use the other die');
  assert.deepEqual(tb.remaining, [1]);
  tb.play(tb.stepFor(18, 17));
  assert.equal(tb.done, true);
  assert.deepEqual(tb.legal(), []);
  assert.deepEqual(tb.wire(), [[24, 6], [18, 1]]);

  assert.equal(tb.undo(), true);
  assert.equal(tb.done, false);
  tb.reset();
  assert.equal(tb.empty, true);
  assert.equal(tb.position.toText(), Position.initial(rules).toText());
  assert.equal(tb.undo(), false);
});

test('turn builder never mutates the position it was given', () => {
  const start = Position.initial(rules);
  const before = start.toText();
  const tb = new TurnBuilder(start, T1, [6, 1]);
  tb.play(tb.stepFor(24, 18));
  assert.equal(start.toText(), before);
});

test('turn builder: bearing off with two dice uses the smaller one, and a forced die is respected', () => {
  const both = new TurnBuilder(pos({ 3: 't1:1', 2: 't1:1' }), T1, [5, 6]);
  assert.deepEqual(both.targetsFrom(3), [{ to: 0, die: 5 }], 'either die bears the checker off; the smaller one is used');
  both.play(both.stepFor(3, 0));
  assert.equal(both.done, false);
  assert.deepEqual(both.legal().map((s) => [s.from, s.die]), [[2, 6]]);
  both.play(both.stepFor(2, 0));
  assert.equal(both.done, true);

  const single = new TurnBuilder(pos({ 3: 't1:1' }), T1, [5, 6]);
  assert.deepEqual(single.targetsFrom(3), [{ to: 0, die: 6 }], 'only one die can be used, so the larger one is forced');

  const forced = new TurnBuilder(pos({ 8: 't1:1', 1: 'b1:2' }), T1, [3, 4]);
  assert.deepEqual(forced.legal().map((s) => s.die), [4], 'only the larger die may be played');
});

test('turn builder: replaying a suggestion accepts legal turns and rejects the rest', () => {
  const tb = new TurnBuilder(Position.initial(rules), T1, [6, 1]);
  assert.equal(tb.replay([[24, 6], [18, 1]]), true);
  assert.equal(tb.done, true);
  assert.equal(tb.replay([[24, 5]]), false);
  assert.equal(tb.empty || tb.steps.length < 2, true);
  assert.equal(tb.replay([[24, 1], [24, 6]]), true);
  assert.deepEqual(tb.wire(), [[24, 1], [24, 6]]);
});

test('withTargets adds destinations to a wire turn and stops at an illegal step', () => {
  const position = Position.initial(rules);
  assert.deepEqual(withTargets(position, T1, [[24, 6], [18, 1]]), [[24, 6, 18], [18, 1, 17]]);
  assert.deepEqual(withTargets(position, T1, [[24, 6], [13, 1]]), [[24, 6, 18]]);
  assert.deepEqual(withTargets(pos({ 2: 't1:1' }), T1, [[2, 4]]), [[2, 4, 0]]);
});

test('clock model counts down only the running team and tolerates clock offsets', () => {
  let now = 1_000_000;
  const model = new ClockModel(() => now);
  model.update({ pools: [60000, 45000], running: 1, asOf: 5_000 }, 5_000);
  assert.equal(model.remaining(0), 60000);
  assert.equal(model.remaining(1), 45000);
  now += 10_000;
  assert.equal(model.remaining(1), 35000);
  assert.equal(model.remaining(0), 60000);
  now += 999_999;
  assert.equal(model.remaining(1), 0, 'never negative');

  const skewed = new ClockModel(() => 50_000);
  skewed.update({ pools: [10000, 10000], running: 0, asOf: 7_000 }, 8_000);
  assert.equal(skewed.remaining(0, 50_000), 10000 - (50_000 - (7_000 + 50_000 - 8_000)), 'asOf is converted with the server offset');
  model.update({ pools: [1000, 1000], running: null, asOf: 5_000 }, 5_000);
  now += 50_000;
  assert.equal(model.remaining(0), 1000, 'a stopped clock stays put');
});

test('formatting helpers', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(59_001), '1:00');
  assert.equal(formatClock(60_000), '1:00');
  assert.equal(formatClock(9 * 60_000 + 5_000), '9:05');
  assert.equal(formatClock(3_661_000), '1:01:01');
  assert.equal(formatClock(-5), '0:00');
  assert.equal(describeStep([24, 6, 18]), '24\u219218');
  assert.equal(describeStep([2, 5, 0]), '2\u2192off');
  assert.equal(seatTitle('t2'), 'Top 2');
  assert.equal(seatTitle('b1'), 'Bottom 1');
  assert.equal(describeTurn({ actor: 't1', dice: [6, 1], steps: [[24, 6, 18], [18, 1, 17]], passed: false }), 'Top 1 rolled 6-1: 24\u219218, 18\u219217');
  assert.equal(describeTurn({ actor: 'b2', dice: [3, 3], steps: [], passed: true }), 'Bottom 2 rolled 3-3: no legal move');
  assert.equal(resultText({ winnerTeam: 0, reason: 'bearoff' }), 'Top team wins: all 16 checkers are home');
  assert.equal(resultText({ winnerTeam: 1, reason: 'timeout' }), 'Bottom team wins: Top team ran out of time');
  assert.equal(resultText({ winnerTeam: 0, reason: 'resign' }), 'Top team wins: Bottom team resigned');
  assert.match(resultText({ winnerTeam: -1, reason: 'deadlock' }), /^Draw/);
  assert.match(resultText({ winnerTeam: -1, reason: 'abandoned' }), /abandoned/);
  assert.equal(resultText(null), '');
  assert.equal(resultReason(null), '');
  assert.equal(resultReason({ winnerTeam: 0, reason: 'bearoff' }), 'All 16 checkers are home.');
  assert.equal(resultReason({ winnerTeam: 1, reason: 'timeout' }), 'The Top team ran out of time.');
  assert.equal(resultReason({ winnerTeam: 0, reason: 'resign' }), 'The Bottom team resigned.');
  assert.match(resultReason({ winnerTeam: -1, reason: 'deadlock' }), /pip counts are equal/);
  assert.match(resultReason({ winnerTeam: 1, reason: 'deadlock' }), /fewer pips/);
  assert.match(resultReason({ winnerTeam: -1, reason: 'abandoned' }), /abandoned/);
  assert.match(resultReason({ winnerTeam: -1, reason: 'error' }), /server problem/);
  assert.equal(errorMessage('invalid_credentials'), 'Wrong username or password.');
  assert.match(errorMessage('weird_new_code'), /weird_new_code/);
  assert.equal(rulesFor('quadrant-plakoto-4p'), rulesFor(undefined));
  assert.equal(rulesFor('unknown-variant').seatIds.length, 4, 'falls back to the standard rules');
  assert.equal(signed(12), '+12');
  assert.equal(signed(0), '+0');
  assert.equal(signed(-7), '\u22127');
  const hello = { botLevels: { 3: 'Easy' }, botRatings: { 3: 1077 } };
  assert.equal(levelLabel(hello, 3), '3 \u2013 Easy (1077)');
  assert.equal(levelLabel({ botLevels: { 3: 'Easy' } }, 3), '3 \u2013 Easy', 'older servers send no ratings');
  assert.equal(levelLabel(undefined, 3), '3 \u2013 Bot');
});

test('seat styling: every seat has its own colours and numeral', () => {
  const fills = new Set(['t1', 'b1', 't2', 'b2'].map((s) => seatStyle(s).mid));
  assert.equal(fills.size, 4);
  assert.deepEqual(['t1', 't2', 'b1', 'b2'].map(seatNumeral), ['1', '2', '1', '2']);
  assert.equal(seatStyle('zz').mid, '#aaaaaa');
});

const seatsOf = (over = {}) => ({
  t1: { kind: 'human', name: 'alice', ready: true, connected: true },
  b1: { kind: 'bot', name: 'Easy bot', ready: true, connected: true, level: 3 },
  t2: { kind: 'human', name: 'carol', ready: false, connected: true },
  b2: { kind: 'bot', name: 'Easy bot', ready: true, connected: true, level: 3 },
  ...over,
});

test('view model: whose turn it is and who may suggest', () => {
  const game = { actor: 't1', slotSeat: 't1', dice: [3, 4], result: null, turnNumber: 4 };
  const base = { phase: 'playing', seats: seatsOf(), game };
  const mine = deriveView({ ...base, you: { seat: 't1', host: true, suggestions: [] } }, rules);
  assert.deepEqual([mine.myTurn, mine.canSuggest, mine.live, mine.rolled, mine.flipped, mine.viewTeam], [true, false, true, true, false, 0]);
  const mate = deriveView({ ...base, you: { seat: 't2', host: false, suggestions: [] } }, rules);
  assert.deepEqual([mate.myTurn, mate.canSuggest, mate.actorName], [false, true, 'alice']);
  const foe = deriveView({ ...base, seats: seatsOf({ b1: { kind: 'human', name: 'bob', ready: true, connected: true } }), you: { seat: 'b1', host: false, suggestions: [] } }, rules);
  assert.deepEqual([foe.myTurn, foe.canSuggest, foe.flipped, foe.viewTeam, foe.myTeam], [false, false, true, 1, 1]);
  const watcher = deriveView({ ...base, you: { seat: null, host: false, suggestions: [] } }, rules);
  assert.deepEqual([watcher.myTurn, watcher.canSuggest, watcher.flipped, watcher.myTeam], [false, false, false, null]);
  const between = deriveView({ ...base, game: { ...game, dice: null }, you: { seat: 't1', host: false, suggestions: [] } }, rules);
  assert.deepEqual([between.myTurn, between.rolled, between.live], [false, false, true]);
  const finished = deriveView({ ...base, phase: 'over', game: { ...game, result: { winnerTeam: 0, reason: 'bearoff' } }, you: { seat: 't1', host: false, suggestions: [] } }, rules);
  assert.deepEqual([finished.myTurn, finished.live, finished.over], [false, false, true]);
  const transfer = deriveView({ ...base, game: { ...game, slotSeat: 't2' }, you: { seat: 't1', host: false, suggestions: [] } }, rules);
  assert.equal(transfer.transferred, true);
});

test('view model: lobby readiness', () => {
  const lobby = deriveView({ phase: 'lobby', seats: seatsOf(), game: null, you: { seat: 't2', host: false, suggestions: [] } }, rules);
  assert.deepEqual([lobby.full, lobby.everyoneReady, lobby.humans], [true, false, ['t1', 't2']]);
  const empty = deriveView({ phase: 'lobby', seats: seatsOf({ b2: null }), game: null, you: { seat: null, host: false, suggestions: [] } }, rules);
  assert.equal(empty.full, false);
});

test('seat and team statistics', () => {
  const start = Position.initial(rules);
  assert.deepEqual(seatStats(start, rules).map((s) => s.pips), [192, 192, 144, 144]);
  assert.deepEqual(teamStats(start, rules), [{ pips: 336, off: 0, total: 16 }, { pips: 336, off: 0, total: 16 }]);
  const later = pos({ 3: 't1:1' }, { t1: 7, t2: 8, b1: 2 });
  assert.deepEqual(teamStats(later, rules)[0], { pips: 3, off: 15, total: 16 });
  assert.equal(seatStats(later, rules)[T2].off, 8);
  assert.equal(seatStats(later, rules)[B2].pips, 0);
  assert.equal(seatStats(later, rules)[B1].off, 2);
});
