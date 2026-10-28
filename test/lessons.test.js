import test from 'node:test';
import assert from 'node:assert/strict';
import { LESSONS } from '../client/js/lessons.js';
import { TurnBuilder } from '../client/js/turn.js';
import { rulesFor } from '../client/js/format.js';

const rules = rulesFor();
const board = LESSONS.filter((lesson) => !lesson.final);
const seatOf = (id) => rules.seatIndex.get(id);
const builderFor = (lesson) => new TurnBuilder(lesson.position(), seatOf(lesson.seat), lesson.dice);
const lessonById = (id) => LESSONS.find((lesson) => lesson.id === id);

test('every lesson board is a consistent position with a turn to play', () => {
  assert.equal(board.length, LESSONS.length - 1, 'only the last lesson has no board');
  assert.equal(LESSONS.at(-1).final, true);
  for (const lesson of board) {
    assert.deepEqual(lesson.position().checkInvariants(), [], lesson.id);
    assert.ok(builderFor(lesson).movablePoints().length > 0, `${lesson.id} has a legal move`);
  }
});

test('each lesson accepts its solution and answers a legal turn that misses the point with a hint', () => {
  for (const lesson of board) {
    const solved = builderFor(lesson);
    assert.equal(solved.replay(lesson.solution), true, `${lesson.id}: the solution is legal`);
    assert.equal(solved.done, true, `${lesson.id}: the solution uses every die`);
    assert.equal(lesson.check(solved.steps), null, `${lesson.id}: the solution passes`);
    if (!lesson.wrong) continue;
    const other = builderFor(lesson);
    assert.equal(other.replay(lesson.wrong), true, `${lesson.id}: the wrong turn is legal`);
    assert.equal(typeof lesson.check(other.steps), 'string', `${lesson.id}: it gets a hint`);
  }
});

test('the lessons show what they teach', () => {
  const blocks = builderFor(lessonById('blocks'));
  assert.equal(blocks.legal().some((s) => s.from === 14 && s.die === 4), false, 'two enemy checkers block point 10');
  assert.equal(blocks.legal().some((s) => s.from === 14 && s.die === 2), true);

  const pins = builderFor(lessonById('pins'));
  assert.equal(pins.position.pinned[14], -1);
  pins.replay(lessonById('pins').solution);
  assert.equal(pins.position.pinned[14], seatOf('b1'), 'the lone Pearl checker is pinned');

  const bearoff = builderFor(lessonById('bearoff'));
  assert.equal(bearoff.position.allHome(seatOf('t1')), true);
  bearoff.replay(lessonById('bearoff').solution);
  assert.equal(bearoff.position.off[seatOf('t1')], 5);
});
