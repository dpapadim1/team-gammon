import { diceList } from '../../engine/index.js';
import { h, mount } from './dom.js';
import { buildScene } from './scene.js';
import { dieElement, renderBoard } from './render.js';
import { TurnBuilder } from './turn.js';
import { LESSONS } from './lessons.js';
import { rulesFor } from './format.js';

const rules = rulesFor();
const $ = (id) => document.getElementById(id);

let index = 0;
let builder = null;
let selected = null;
let outcome = null; // null while playing, then { ok, text }

function start(i) {
  index = i;
  selected = null;
  outcome = null;
  const lesson = LESSONS[index];
  builder = lesson.final ? null : new TurnBuilder(lesson.position(), rules.seatIndex.get(lesson.seat), lesson.dice);
  render();
}

function afterPlay() {
  if (builder.done) {
    const hint = LESSONS[index].check(builder.steps);
    outcome = hint === null ? { ok: true, text: LESSONS[index].done } : { ok: false, text: hint };
  }
  render();
}

function onPoint(p) {
  if (!builder || builder.done) return;
  if (selected !== null && p !== selected) {
    const step = builder.stepFor(selected, p);
    if (step) {
      builder.play(step);
      selected = null;
      afterPlay();
      return;
    }
  }
  selected = p !== selected && builder.movablePoints().includes(p) ? p : null;
  render();
}

function onOff() {
  if (!builder || builder.done || selected === null) return;
  const step = builder.stepFor(selected, 0);
  if (!step) return;
  builder.play(step);
  selected = null;
  afterPlay();
}

function renderDice(lesson) {
  if (!builder) {
    mount($('dice'));
    return;
  }
  const left = builder.remaining.slice();
  mount($('dice'), h('div', { class: 'dice' }, diceList(lesson.dice).map((d) => {
    const i = left.indexOf(d);
    if (i >= 0) left.splice(i, 1);
    return dieElement(d, i < 0);
  })));
}

function renderBoardArea() {
  if (!builder) {
    mount($('board'));
    return;
  }
  const ui = { actor: builder.seat, movable: builder.movablePoints(), selected: selected ?? undefined, targets: selected !== null ? builder.targetsFrom(selected) : [] };
  const scene = buildScene({ rules, position: builder.position, viewTeam: 0, ui });
  mount($('board'), renderBoard(scene, builder.done ? {} : { onPoint, onOff, onBackground: () => { selected = null; render(); } }, 'Lesson board'));
}

function render() {
  const lesson = LESSONS[index];
  $('progress').textContent = `Lesson ${index + 1} of ${LESSONS.length}`;
  $('title').textContent = lesson.title;
  mount($('text'), lesson.text.map((t) => h('p', null, t)));
  renderDice(lesson);
  renderBoardArea();
  const feedback = $('feedback');
  feedback.textContent = outcome?.text ?? '';
  feedback.className = `feedback${outcome ? (outcome.ok ? ' ok' : ' hint') : ''}`;
  $('back').disabled = index === 0;
  $('undo').hidden = !builder;
  $('undo').disabled = !builder || builder.empty || outcome?.ok === true;
  $('retry').hidden = !builder;
  $('retry').disabled = !builder || builder.empty;
  $('next').hidden = lesson.final === true;
  $('next').disabled = !(outcome?.ok === true);
  $('finish').hidden = lesson.final !== true;
}

$('back').addEventListener('click', () => start(index - 1));
$('next').addEventListener('click', () => start(index + 1));
$('retry').addEventListener('click', () => start(index));
$('undo').addEventListener('click', () => {
  if (!builder) return;
  builder.undo();
  selected = null;
  outcome = null;
  render();
});

start(0);
