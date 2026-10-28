import { Game, IllegalMoveError, enumerateTurns, reverseCycle } from '../engine/index.js';
import { TeamClock } from './clock.js';
import { fail } from './errors.js';

function withTargets(position, seat, wireSteps) {
  const work = position.clone();
  return wireSteps.map(([from, die]) => [from, die, work.applyStep(seat, from, die).to]);
}

// Runs one game: server rolls, bot turns after a short delay, team clocks (charged only while a human is on turn) and the result.
export class GameSession {
  constructor({ variant, reversed, firstSlot, controllers, rollDice, poolMs, incrementMs, timing, now = Date.now, onChange, onOver }) {
    this.variant = variant;
    this.reversed = reversed;
    this.firstSlot = firstSlot;
    this.game = new Game(reversed ? reverseCycle(variant) : variant, { firstSlot });
    this.rules = this.game.rules;
    this.controllers = controllers;
    this.rollDice = rollDice;
    this.timing = timing;
    this.now = now;
    this.clock = new TeamClock({ poolMs, incrementMs, now });
    this.onChange = onChange;
    this.onOver = onOver;
    this.result = null;
    this.last = null;
    this.timer = null;
    this.flagTimer = null;
    this.startedAt = now();
  }

  cycleIds() {
    return Array.from(this.rules.turnOrder, (s) => this.rules.seatIds[s]);
  }

  start() {
    this.schedule(() => this.rollNow(), this.timing.startDelayMs);
  }

  stop() {
    clearTimeout(this.timer);
    clearTimeout(this.flagTimer);
    this.timer = null;
    this.flagTimer = null;
  }

  // Timer callbacks never throw into the event loop: an unexpected failure ends the game as a draw.
  schedule(fn, ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        fn();
      } catch (err) {
        console.error('game session failed', err);
        this.finish({ winnerTeam: -1, reason: 'error' });
      }
    }, ms);
  }

  rollNow() {
    if (this.result) return;
    const rolled = this.game.roll(this.rollDice());
    if (rolled.passed) {
      this.last = this.describe(rolled.entry, []);
      if (this.game.over) return this.finishFromEngine();
      this.onChange(this);
      return this.schedule(() => this.rollNow(), this.timing.passDelayMs);
    }
    return this.beginTurn();
  }

  beginTurn() {
    const actor = this.game.actor;
    if (this.controllers[actor].kind === 'human') {
      this.clock.start(this.rules.teamOf[actor]);
      this.armFlag();
      this.onChange(this);
      return;
    }
    this.clock.stop();
    this.onChange(this);
    const jitter = Math.floor(Math.random() * this.timing.botThinkMs * 0.5);
    this.schedule(() => this.botMove(), this.timing.botThinkMs + jitter);
  }

  botMove() {
    if (this.result || this.game.phase !== 'move') return;
    let steps;
    try {
      steps = this.controllers[this.game.actor].bot.chooseTurn(this.game);
    } catch (err) {
      console.error('bot failed, playing a random turn instead', err);
      steps = enumerateTurns(this.game.position, this.game.actor, this.game.dice, { limits: this.game.limits })[0].steps;
    }
    this.applyTurn(steps);
  }

  // The engine validates the whole turn before changing anything, so a rejected turn leaves the session untouched.
  applyTurn(steps) {
    const actor = this.game.actor;
    const team = this.rules.teamOf[actor];
    const before = this.game.position.clone();
    const entry = this.game.playTurn(steps);
    clearTimeout(this.flagTimer);
    this.flagTimer = null;
    if (this.controllers[actor].kind === 'human') {
      this.clock.stop();
      this.clock.addIncrement(team);
    }
    this.last = this.describe(entry, withTargets(before, actor, entry.steps));
    if (this.game.over) return this.finishFromEngine();
    this.onChange(this);
    return this.schedule(() => this.rollNow(), this.timing.rollDelayMs);
  }

  // Human turn: `seatIndex` must be the seat on turn.
  playTurn(seatIndex, steps) {
    if (this.result) fail('game_over');
    if (this.game.phase !== 'move' || seatIndex !== this.game.actor || this.controllers[seatIndex].kind !== 'human') fail('not_your_turn');
    try {
      this.applyTurn(steps);
    } catch (err) {
      if (err instanceof IllegalMoveError) fail('illegal_turn', err.message);
      throw err;
    }
  }

  resign(team) {
    if (this.result) fail('game_over');
    this.finish({ winnerTeam: 1 - team, reason: 'resign' });
  }

  armFlag() {
    clearTimeout(this.flagTimer);
    const team = this.clock.running;
    if (team === null) return;
    this.flagTimer = setTimeout(() => this.checkFlag(), this.clock.remaining(team) + 10);
  }

  checkFlag() {
    this.flagTimer = null;
    const team = this.clock.running;
    if (team === null || this.result) return;
    if (this.clock.remaining(team) <= 0) this.finish({ winnerTeam: 1 - team, reason: 'timeout' });
    else this.armFlag();
  }

  finishFromEngine() {
    const r = this.game.result();
    this.finish({ winnerTeam: r.winnerTeam, reason: r.reason });
  }

  finish(result) {
    if (this.result) return;
    this.result = result;
    this.clock.stop();
    this.stop();
    this.onOver(this);
  }

  describe(entry, steps) {
    const R = this.rules;
    return {
      actor: R.seatIds[entry.actor],
      slotSeat: R.seatIds[R.turnOrder[entry.slot]],
      dice: entry.dice,
      steps,
      passed: steps.length === 0,
    };
  }

  snapshot() {
    const g = this.game;
    const R = this.rules;
    return {
      variant: this.variant.id,
      reversed: this.reversed,
      cycle: this.cycleIds(),
      position: g.position.toText(),
      turnNumber: g.turnNumber,
      slot: g.slot,
      slotSeat: R.seatIds[g.slotSeat],
      actor: R.seatIds[g.actor],
      dice: this.result ? null : g.dice ? g.dice.slice() : null,
      target: this.result || !g.limits ? null : g.limits.target,
      forcedDie: this.result || !g.limits ? null : g.limits.forcedDie,
      last: this.last,
      clocks: this.clock.snapshot(),
      result: this.result,
    };
  }
}
