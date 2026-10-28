import { Position } from '../../engine/index.js';
import { rulesFor } from './format.js';

const rules = rulesFor();

// A position from {point: 'seat:n+seat:n'} and the borne-off counts {seat: n}; every other point is empty.
function layout(points, off = {}) {
  const parts = [];
  for (let p = 1; p <= rules.N; p++) parts.push(points[p] ?? '.');
  return Position.fromText(rules, `${parts.join('/')} ${rules.seatIds.map((id) => off[id] ?? 0).join(',')}`);
}

// One lesson is one turn on a prepared board. `check` gets the steps the learner played ({from, die, to}) and returns
// null when the lesson is learned, or a hint. `solution` and `wrong` are [from, die] turns used by the tests.
export const LESSONS = [
  {
    id: 'move',
    title: 'Moving your checkers',
    text: [
      'You are Silver 1. Your eight checkers start on point 24 and travel down towards point 1, where your home board is. Two dice decide how far you may move: this turn you rolled a 6 and a 3.',
      'Click one of your checkers, then click a lit point to move it. Use each die once. You can move one checker twice or two different checkers.',
    ],
    seat: 't1',
    dice: [6, 3],
    position: () => Position.initial(rules),
    check: () => null,
    solution: [[24, 6], [24, 3]],
    done: 'Both dice are played. In a real game your turn is sent as soon as it is complete, and a die you cannot play is simply lost.',
  },
  {
    id: 'blocks',
    title: 'Blocked points',
    text: [
      'Two or more enemy checkers block a point: you can never land there. Pearl 1 has two checkers on point 10, so a checker from point 14 cannot use a 4.',
      'You rolled a 4 and a 2. Run one checker from point 14 to point 8: play the 2 first, then the 4 with the same checker. Click the checker on 14 and see which points light up.',
    ],
    seat: 't1',
    dice: [4, 2],
    position: () => layout({ 1: 'b1:6', 7: 'b2:8', 10: 'b1:2', 14: 't1:2', 18: 't2:8', 24: 't1:6' }),
    check: (steps) => (steps.length === 2 && steps[0].from === 14 && steps[0].die === 2 && steps[1].from === 12 && steps[1].die === 4
      ? null : 'That turn is legal, but not the one in this lesson. Press Try again and play the 2 from point 14 first.'),
    solution: [[14, 2], [12, 4]],
    wrong: [[24, 4], [24, 2]],
    done: 'Right: point 10 was blocked, so the 4 had to wait until the checker stood on point 12. Blocks are your best defence, too: two of your checkers on a point stop the enemy.',
  },
  {
    id: 'pins',
    title: 'Pinning a lone checker',
    text: [
      'A single enemy checker is not blocked, it is pinned, as in the Greek game Plakoto. Land on it and it stays under your checker, marked with a red ring. It cannot move until the checkers on top of it have left.',
      'Pearl 1 has one lone checker on point 14. You rolled a 3 and a 1: move the checker from point 17 onto point 14 with the 3 to pin it, then play the 1 anywhere you like.',
      'Good to know: a lone checker standing on its own start point is safe and can never be pinned.',
    ],
    seat: 't1',
    dice: [3, 1],
    position: () => layout({ 1: 'b1:7', 7: 'b2:8', 14: 'b1:1', 17: 't1:1', 18: 't2:8', 24: 't1:7' }),
    check: (steps) => (steps.some((s) => s.from === 17 && s.to === 14) ? null : 'Use the 3 to move the checker from point 17 onto the lone Pearl checker on point 14.'),
    solution: [[17, 3], [24, 1]],
    wrong: [[24, 3], [24, 1]],
    done: 'Pinned! Pearl 1 cannot move that checker for as long as yours stays on top, and Pearl cannot land on point 14 either. Your team can still use the point freely.',
  },
  {
    id: 'bearoff',
    title: 'Bearing off',
    text: [
      'Once all of your remaining checkers are on your home points (1 to 6 for Silver and Bronze), you can take them off the board. A die takes off a checker that is exactly that many points from the edge.',
      'You rolled a 6 and a 2. Click the checker on point 6, then click the tray on the right to bear it off. Do the same for a checker on point 2.',
    ],
    seat: 't1',
    dice: [6, 2],
    position: () => layout({ 1: 'b1:8', 2: 't1:1', 3: 't1:1', 4: 't1:1', 6: 't1:2', 7: 'b2:8', 18: 't2:8' }, { t1: 3 }),
    check: (steps) => (steps.every((s) => s.to === 0) ? null : 'Bear a checker off with each die: click the checker, then the tray on the right.'),
    solution: [[6, 6], [2, 2]],
    wrong: [[4, 2], [6, 6]],
    done: 'Two checkers are off. The first team to bring all sixteen of its checkers off wins, so keep the whole team moving.',
  },
  {
    id: 'team',
    title: 'Playing together',
    text: [
      'Four players sit at a table, two per team, and the turns alternate between the teams. When your partner is on turn you can click checkers on the board to sketch a move for them; only your team sees it, and your partner can use it with one click.',
      'Your team shares one clock, which only runs while a person is on turn. When one of you has brought all eight checkers home, your teammate plays the rolls of the finished seat.',
      'The quickest way to learn the rest is to play: start a quick game against bots and take it easy on level 1 or 2.',
    ],
    final: true,
  },
];
