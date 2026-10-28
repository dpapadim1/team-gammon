import { compileVariant, QUADRANT_PLAKOTO_4P } from './variant.js';
import { Position } from './position.js';
import { diceList, legalNextSteps, normalizeSteps, stepsToWire, turnLimits, validateTurn } from './turns.js';

export class IllegalMoveError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IllegalMoveError';
  }
}

// True when no unfinished seat could ever move again (no step exists for any die value).
export function isDeadlocked(pos) {
  for (let s = 0; s < pos.rules.S; s++) {
    if (pos.isFinished(s)) continue;
    for (let die = 1; die <= 6; die++) if (pos.legalFroms(s, die).length > 0) return false;
  }
  return true;
}

// Team with fewer pips left wins; -1 is a draw.
export function winnerByPips(pos) {
  const R = pos.rules;
  const pips = [0, 1].map((t) => R.teamSeats[t].reduce((sum, s) => sum + pos.pipsLeft(s), 0));
  return pips[0] < pips[1] ? 0 : pips[1] < pips[0] ? 1 : -1;
}

export class Game {
  constructor(variant = QUADRANT_PLAKOTO_4P, { firstSlot = 0, position = null } = {}) {
    this.rules = compileVariant(variant);
    if (position && position.rules !== this.rules) throw new Error('position was built for a different variant');
    this.position = position ?? Position.initial(this.rules);
    this.slot = firstSlot;
    this.actor = -1;
    this.turnNumber = 0;
    this.dice = null;
    this.remaining = [];
    this.steps = [];
    this.limits = null;
    this._undo = [];
    this.history = [];
    this.over = false;
    this.winnerTeam = null;
    this.endReason = null;
    this._resolveActor();
    for (let team = 0; team < 2 && !this.over; team++) {
      if (this.position.teamFinished(team)) this._end(team, 'bearoff');
    }
  }

  get phase() {
    if (this.over) return 'over';
    return this.dice ? 'move' : 'roll';
  }

  get slotSeat() {
    return this.rules.turnOrder[this.slot];
  }

  result() {
    return this.over ? { winnerTeam: this.winnerTeam, reason: this.endReason } : null;
  }

  // A finished seat's roll is played by its teammate.
  _resolveActor() {
    const seat = this.rules.turnOrder[this.slot];
    this.actor = seat;
    if (!this.position.isFinished(seat)) return;
    for (const mate of this.rules.mates[seat]) {
      if (!this.position.isFinished(mate)) {
        this.actor = mate;
        return;
      }
    }
  }

  _end(winnerTeam, reason) {
    this.over = true;
    this.winnerTeam = winnerTeam;
    this.endReason = reason;
  }

  _endByPips(reason) {
    this._end(winnerByPips(this.position), reason);
  }

  roll(dice) {
    if (this.over) throw new IllegalMoveError('the game is over');
    if (this.dice) throw new IllegalMoveError('the dice were already rolled this turn');
    if (!Array.isArray(dice) || dice.length !== 2 || !dice.every((d) => Number.isInteger(d) && d >= 1 && d <= 6)) {
      throw new IllegalMoveError('dice must be two integers between 1 and 6');
    }
    this.dice = [dice[0], dice[1]];
    this.remaining = diceList(this.dice);
    this.steps = [];
    this._undo = [];
    this.limits = turnLimits(this.position, this.actor, this.dice);
    if (this.limits.target === 0) return { passed: true, entry: this._finishTurn() };
    return { passed: false, target: this.limits.target, forcedDie: this.limits.forcedDie };
  }

  legalSteps() {
    if (this.phase !== 'move') return [];
    return legalNextSteps(this.position, this.actor, this.remaining, this.steps.length, this.limits);
  }

  playStep(from, die) {
    if (this.phase !== 'move') throw new IllegalMoveError('no dice to play');
    const step = this.legalSteps().find((st) => st.from === from && st.die === die);
    if (!step) throw new IllegalMoveError(`point ${from} cannot move ${die} now`);
    this._undo.push(this.position.applyStep(this.actor, from, die, step.to));
    this.steps.push(step);
    this.remaining.splice(this.remaining.indexOf(die), 1);
    if (this.steps.length >= this.limits.target) return this._finishTurn();
    return null;
  }

  undoStep() {
    if (this.phase !== 'move' || this.steps.length === 0) throw new IllegalMoveError('nothing to undo');
    this.position.undoStep(this._undo.pop());
    this.remaining.push(this.steps.pop().die);
  }

  // Plays a complete turn atomically: either every step is legal and the turn is full, or nothing changes.
  playTurn(steps) {
    if (this.phase !== 'move') throw new IllegalMoveError('no dice to play');
    if (this.steps.length > 0) throw new IllegalMoveError('a turn is already in progress');
    const normalised = normalizeSteps(steps);
    const check = validateTurn(this.position, this.actor, this.dice, normalised);
    if (!check.ok) throw new IllegalMoveError(check.error);
    let entry = null;
    for (const st of normalised) entry = this.playStep(st.from, st.die);
    return entry;
  }

  _finishTurn() {
    const R = this.rules;
    const entry = { slot: this.slot, actor: this.actor, dice: this.dice.slice(), steps: stepsToWire(this.steps) };
    this.history.push(entry);
    this.turnNumber++;
    this.dice = null;
    this.remaining = [];
    this.steps = [];
    this.limits = null;
    this._undo = [];
    const team = R.teamOf[entry.actor];
    if (this.position.teamFinished(team)) {
      this._end(team, 'bearoff');
    } else if (entry.steps.length === 0 && isDeadlocked(this.position)) {
      this._endByPips('deadlock');
    } else {
      this.slot = (this.slot + 1) % R.S;
      this._resolveActor();
    }
    return entry;
  }

  clone() {
    const g = Object.create(Game.prototype);
    Object.assign(g, this);
    g.position = this.position.clone();
    g.dice = this.dice ? this.dice.slice() : null;
    g.remaining = this.remaining.slice();
    g.steps = this.steps.slice();
    g._undo = this._undo.slice();
    g.history = this.history.slice();
    g.limits = this.limits ? { ...this.limits } : null;
    return g;
  }

  static replay(history, { variant = QUADRANT_PLAKOTO_4P, firstSlot = history[0]?.slot ?? 0, position = null } = {}) {
    const game = new Game(variant, { firstSlot, position });
    for (const entry of history) {
      if (game.over) throw new IllegalMoveError('history continues after the game ended');
      if (game.slot !== entry.slot || game.actor !== entry.actor) throw new IllegalMoveError('history does not match the turn order');
      const rolled = game.roll(entry.dice);
      if (rolled.passed) {
        if (entry.steps.length > 0) throw new IllegalMoveError('history plays a turn that must be a pass');
      } else {
        game.playTurn(entry.steps);
      }
    }
    return game;
  }
}
