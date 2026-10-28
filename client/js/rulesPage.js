import { Position } from '../../engine/index.js';
import { buildScene } from './scene.js';
import { renderBoard } from './render.js';
import { rulesFor } from './format.js';

const rules = rulesFor();

// Pearl 1 (b1) has one checker pinned on point 14 under a Silver checker (t1).
const PIN_POINTS = {
  1: 'b1:3', 5: 't1:1', 7: 'b2:3', 8: 't2:2', 9: 'b1:2', 10: 'b2:2', 11: 't1:2', 13: 't2:2',
  14: 't1:1+b1:1!', 16: 'b2:2', 17: 't1:1', 18: 't2:4', 20: 'b1:2', 21: 'b2:1', 24: 't1:3',
};

function pinPosition() {
  const parts = [];
  for (let p = 1; p <= rules.N; p++) parts.push(PIN_POINTS[p] ?? '.');
  return Position.fromText(rules, `${parts.join('/')} 0,0,0,0`);
}

document.getElementById('demo-start')?.append(renderBoard(buildScene({ rules, position: Position.initial(rules) }), {}, 'Starting position'));
document.getElementById('demo-pin')?.append(renderBoard(buildScene({ rules, position: pinPosition() }), {}, 'A pinned checker'));
