import { Position, diceList } from '../../engine/index.js';
import { h, mount } from './dom.js';
import { buildScene } from './scene.js';
import { dieElement, renderBoard } from './render.js';
import { TurnBuilder, withTargets } from './turn.js';
import { rulesFor, signed } from './format.js';
import { TEAM_NAMES, seatStyle } from './seats.js';
import { teamStats } from './viewmodel.js';
import { THEME_HINTS, afterText, describePlay, isProvisional, parseProgress, pickNext, puzzleKey, puzzleRating, rateAttempt, stepsText, summary, verdict, winRate } from './puzzles.js';

const rules = rulesFor();
const STORAGE_KEY = 'tg.puzzles';
const THEME_NAMES = { pin: 'Pinning', block: 'Blocking', bearoff: 'Bearing off', position: 'Positional play' };
const $ = (id) => document.getElementById(id);
const pct = (x) => `${(100 * x).toFixed(1)}%`;

let data = null;
let ctx = null; // the open puzzle: board state, the user's play and what has been revealed

// The rating and the first attempt at every puzzle, by puzzleKey: ids change when the set is regenerated, keys do not.
const progress = parseProgress(readStorage());
const attempt = (puzzle) => progress.results[puzzle.key];

function readStorage() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveProgress() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // storage can be blocked; progress then only lasts for this visit
  }
}

// --- list ----------------------------------------------------------------------

function renderList() {
  const seen = data.puzzles.filter(attempt).sort((a, b) => attempt(b).n - attempt(a).n);
  const next = pickNext(data.puzzles, progress);
  $('rating').textContent = Math.round(progress.rating);
  $('provisional').hidden = !isProvisional(progress);
  $('progress').textContent = `${seen.filter((p) => attempt(p).solved).length} of ${data.puzzles.length} solved`;
  $('start').textContent = next === null ? 'All puzzles solved' : seen.length === 0 ? 'Start' : attempt(next) ? 'Try a missed puzzle' : 'Next puzzle';
  $('start').disabled = next === null;
  $('history').hidden = seen.length === 0;
  mount($('grid'), seen.map((p) => h('li', null,
    h('button', { type: 'button', class: `puzzle-card${attempt(p).solved ? ' solved' : ''}`, 'data-id': p.id, title: `Puzzle rating ${puzzleRating(p)}`, onClick: () => { location.hash = `#${p.id}`; } },
      h('strong', null, `#${p.id}`),
      h('span', { class: `level ${p.difficulty}` }, p.difficulty),
      h('span', { class: `delta ${attempt(p).delta < 0 ? 'down' : 'up'}` }, signed(attempt(p).delta)),
      attempt(p).solved ? h('span', { class: 'tick', 'aria-label': 'solved' }, '\u2713') : null))));
  const waiting = data.puzzles.length - seen.length;
  $('waiting').textContent = waiting === 0 ? '' : `${waiting} more ${waiting === 1 ? 'puzzle is' : 'puzzles are'} waiting for you.`;
}

function showList() {
  ctx = null;
  $('play-view').hidden = true;
  $('list-view').hidden = false;
  document.title = 'Team Gammon \u2013 puzzles';
  renderList();
}

// --- one puzzle ----------------------------------------------------------------

function startPuzzle(puzzle) {
  const seat = rules.seatIndex.get(puzzle.seat);
  const position = Position.fromText(rules, puzzle.position);
  ctx = {
    puzzle,
    seat,
    position,
    viewTeam: rules.teamOf[seat],
    outcomes: puzzle.plays.map((play) => afterText(position, seat, play.steps)),
    builder: new TurnBuilder(position, seat, puzzle.dice),
    selected: null,
    index: null, // which play the user made, once the turn is complete
    reveal: false,
    revealed: false, // the answer was shown, so finding it afterwards does not count as solving
    hints: 0,
    change: null, // the rating change this attempt caused, shown with its verdict only
  };
  $('list-view').hidden = true;
  $('play-view').hidden = false;
  document.title = `Team Gammon \u2013 puzzle ${puzzle.id}`;
  render();
}

function reset() {
  ctx.builder = new TurnBuilder(ctx.position, ctx.seat, ctx.puzzle.dice);
  ctx.selected = null;
  ctx.index = null;
  ctx.reveal = false;
  ctx.change = null;
  render();
}

// The first attempt at a puzzle moves the puzzle rating; later attempts do not.
function rate(score) {
  const change = rateAttempt(progress, ctx.puzzle, score);
  if (change === null) return;
  ctx.change = change;
  saveProgress();
}

function afterPlay() {
  const { builder, puzzle } = ctx;
  if (builder.done) {
    const found = ctx.outcomes.indexOf(builder.position.toText());
    ctx.index = found < 0 ? puzzle.plays.length - 1 : found;
    rate(ctx.index === 0 ? (ctx.hints > 0 ? 0.5 : 1) : 0);
    if (ctx.index === 0 && !ctx.revealed && !attempt(puzzle).solved) {
      attempt(puzzle).solved = true;
      saveProgress();
    }
  }
  render();
  if (builder.done) $('result').scrollIntoView({ block: 'nearest' });
}

function onPoint(p) {
  const { builder } = ctx;
  if (builder.done || ctx.reveal) return;
  if (ctx.selected !== null && p !== ctx.selected) {
    const step = builder.stepFor(ctx.selected, p);
    if (step) {
      builder.play(step);
      ctx.selected = null;
      afterPlay();
      return;
    }
  }
  ctx.selected = p !== ctx.selected && builder.movablePoints().includes(p) ? p : null;
  render();
}

function onOff() {
  const { builder } = ctx;
  if (builder.done || ctx.reveal || ctx.selected === null) return;
  const step = builder.stepFor(ctx.selected, 0);
  if (!step) return;
  builder.play(step);
  ctx.selected = null;
  afterPlay();
}

function nextPuzzle() {
  const next = pickNext(data.puzzles, progress);
  location.hash = next !== null && next !== ctx.puzzle ? `#${next.id}` : '';
}

function giveHint() {
  const best = ctx.puzzle.plays[0];
  ctx.hints = Math.min(3, ctx.hints + 1);
  $('hint-text').textContent = [
    THEME_HINTS[ctx.puzzle.themes[0]],
    `Start with the checker on point ${best.steps[0][0]}.`,
    `The best play moves checkers from points ${best.steps.map(([from]) => from).join(' and ')}.`,
  ][ctx.hints - 1];
}

// --- drawing -------------------------------------------------------------------

function renderDice() {
  const { builder, puzzle } = ctx;
  const left = builder.remaining.slice();
  const faces = diceList(puzzle.dice).map((d) => {
    const i = left.indexOf(d);
    if (i >= 0) left.splice(i, 1);
    return dieElement(d, i < 0);
  });
  mount($('dice'), h('div', { class: 'dice' }, faces));
}

function renderBoardArea() {
  const { builder, puzzle } = ctx;
  const ui = { actor: ctx.seat };
  let position = builder.position;
  let handlers = {};
  if (ctx.reveal) {
    position = ctx.position;
    ui.suggestions = [{ seat: puzzle.seat, steps: withTargets(ctx.position, ctx.seat, puzzle.plays[0].steps) }];
  } else {
    ui.movable = builder.movablePoints();
    ui.selected = ctx.selected ?? undefined;
    ui.targets = ctx.selected !== null ? builder.targetsFrom(ctx.selected) : [];
    if (!builder.done) handlers = { onPoint, onOff, onBackground: () => { ctx.selected = null; render(); } };
  }
  mount($('board'), renderBoard(buildScene({ rules, position, viewTeam: ctx.viewTeam, ui }), handlers, 'Puzzle board'));
}

// What the first attempt did to the puzzle rating; null once that moment has passed.
function ratingLine(prefix) {
  if (ctx.change === null) return null;
  const { before, after, delta, puzzle } = ctx.change;
  return h('p', { class: 'rating-line', id: 'rating-change' }, `${prefix}Puzzle rating ${before} \u2192 ${after} (${signed(delta)}). This puzzle is rated ${puzzle}.`);
}

function resultCard() {
  const { puzzle } = ctx;
  const best = puzzle.plays[0];
  if (ctx.reveal) {
    const d = describePlay(ctx.position, ctx.seat, best.steps);
    return h('div', { class: 'result-card' },
      h('h2', null, 'The best play'),
      h('p', null, h('strong', null, stepsText(d)), `. ${summary(d)}`),
      h('p', { class: 'muted' }, `It won ${pct(best.win)} of ${best.n} games that the neural-network bot played out from here, against ${pct(puzzle.plays[1].win)} for the next best play.`),
      ratingLine('Showing the best play counts as a miss. '));
  }
  if (ctx.index === null) return null;
  const v = verdict(puzzle, ctx.index);
  const mine = puzzle.plays[ctx.index];
  const title = { best: 'Best play!', close: 'Close, but not the best play', mistake: 'Not the best play', blunder: 'That play gives a lot away' }[v.kind];
  const lines = [];
  if (v.kind === 'best') {
    lines.push(h('p', null, `This play won ${pct(best.win)} of ${best.n} games that the neural-network bot played out from here. The next best play won ${pct(puzzle.plays[1].win)}.`));
    const d = describePlay(ctx.position, ctx.seat, best.steps);
    lines.push(h('p', { class: 'muted' }, summary(d)));
  } else if (mine.win === undefined) {
    lines.push(h('p', null, `Your play is estimated to win about ${pct(winRate(puzzle, mine))} of the games; the best play won ${pct(best.win)} of ${best.n} games that the neural-network bot played out from here.`));
  } else {
    lines.push(h('p', null, `Your play won ${pct(mine.win)} of ${mine.n} games that the neural-network bot played out from here; the best play won ${pct(best.win)}.`));
  }
  lines.push(ratingLine(''));
  return h('div', { class: `result-card ${v.kind}`, id: 'verdict', 'data-kind': v.kind }, h('h2', null, title), lines);
}

function render() {
  const { puzzle, builder } = ctx;
  const style = seatStyle(puzzle.seat);
  const tried = attempt(puzzle) !== undefined;
  $('title').textContent = `Puzzle ${puzzle.id}`;
  mount($('meta'), `Your puzzle rating ${Math.round(progress.rating)}`, tried ? [` \u00b7 this puzzle ${puzzleRating(puzzle)} `, h('span', { class: `level ${puzzle.difficulty}` }, puzzle.difficulty), ` \u00b7 ${puzzle.themes.map((t) => THEME_NAMES[t]).join(', ')}`] : null);
  const [a, b] = puzzle.dice;
  const roll = a === b ? `a double ${a}: four moves of ${a}` : `${a} and ${b}`;
  $('prompt').textContent = `You are ${style.name} ${puzzle.seat.slice(1)} of the ${TEAM_NAMES[ctx.viewTeam]} team. You rolled ${roll}: find the best play.`;
  renderDice();
  renderBoardArea();
  const stats = teamStats(ctx.position, rules);
  const notes = [`Pips left: your team ${stats[ctx.viewTeam].pips}, opponents ${stats[1 - ctx.viewTeam].pips}.`];
  if (builder.limits.forcedDie) notes.push(`Only the ${builder.limits.forcedDie} can be played.`);
  else if (builder.limits.target < diceList(puzzle.dice).length) notes.push(`Only ${builder.limits.target} of the dice can be played.`);
  $('pips').textContent = notes.join(' ');
  const card = resultCard();
  $('result').hidden = card === null;
  mount($('result'), card);
  const finished = ctx.index !== null || ctx.reveal;
  $('hint').disabled = finished;
  $('undo').disabled = ctx.reveal || builder.empty;
  $('retry').disabled = !finished && builder.empty;
  $('next').disabled = !tried;
  $('note').hidden = tried;
  $('show').disabled = ctx.reveal;
  if (finished) $('hint-text').textContent = '';
}

// --- start-up ------------------------------------------------------------------

function route() {
  const id = Number(location.hash.slice(1));
  const puzzle = Number.isInteger(id) ? data.puzzles.find((p) => p.id === id) : undefined;
  // A puzzle can be opened once it has been served: it is one already attempted or the one the player is due next.
  if (puzzle !== undefined && (attempt(puzzle) !== undefined || puzzle === pickNext(data.puzzles, progress))) {
    startPuzzle(puzzle);
    return;
  }
  if (location.hash) history.replaceState(null, '', location.pathname);
  showList();
}

$('start').addEventListener('click', () => {
  const next = pickNext(data.puzzles, progress);
  if (next !== null) location.hash = `#${next.id}`;
});
$('all').addEventListener('click', () => { location.hash = ''; });
$('hint').addEventListener('click', giveHint);
$('undo').addEventListener('click', () => {
  ctx.builder.undo();
  ctx.selected = null;
  ctx.index = null;
  ctx.change = null;
  render();
});
$('retry').addEventListener('click', reset);
$('show').addEventListener('click', () => {
  rate(0);
  ctx.builder = new TurnBuilder(ctx.position, ctx.seat, ctx.puzzle.dice);
  ctx.index = null;
  ctx.selected = null;
  ctx.reveal = true;
  ctx.revealed = true;
  render();
  $('result').scrollIntoView({ block: 'nearest' });
});
$('next').addEventListener('click', nextPuzzle);
window.addEventListener('hashchange', () => data && route());

try {
  const res = await fetch('/client/puzzles.json');
  if (!res.ok) throw new Error(`puzzles.json: ${res.status}`);
  data = await res.json();
} catch {
  $('problem').textContent = 'The puzzles could not be loaded. Please reload the page.';
}
if (data) {
  for (const p of data.puzzles) p.key = puzzleKey(p);
  route();
}
