import { diceList, legalNextSteps, turnLimits } from '../../engine/index.js';

// Builds one turn step by step on a private copy of the position, with the same rules the server enforces.
export class TurnBuilder {
  constructor(position, seat, dice) {
    this.position = position.clone();
    this.seat = seat;
    this.dice = [dice[0], dice[1]];
    this.limits = turnLimits(this.position, seat, this.dice);
    this.remaining = diceList(this.dice);
    this.steps = [];
    this.records = [];
  }

  get target() {
    return this.limits.target;
  }

  get done() {
    return this.steps.length >= this.limits.target;
  }

  get empty() {
    return this.steps.length === 0;
  }

  legal() {
    return this.done ? [] : legalNextSteps(this.position, this.seat, this.remaining, this.steps.length, this.limits);
  }

  movablePoints() {
    return [...new Set(this.legal().map((s) => s.from))];
  }

  // Destinations from a point. When two dice bear the same checker off, the smaller one is used.
  targetsFrom(from) {
    const best = new Map();
    for (const s of this.legal()) {
      if (s.from !== from) continue;
      const known = best.get(s.to);
      if (!known || s.die < known.die) best.set(s.to, s);
    }
    return [...best.values()].map((s) => ({ to: s.to, die: s.die }));
  }

  stepFor(from, to) {
    const target = this.targetsFrom(from).find((t) => t.to === to);
    return target ? { from, die: target.die, to } : null;
  }

  play(step) {
    this.records.push(this.position.applyStep(this.seat, step.from, step.die, step.to));
    this.steps.push(step);
    this.remaining.splice(this.remaining.indexOf(step.die), 1);
  }

  undo() {
    if (this.steps.length === 0) return false;
    this.position.undoStep(this.records.pop());
    this.remaining.push(this.steps.pop().die);
    return true;
  }

  reset() {
    while (this.undo());
  }

  // Replays a suggested turn ([[from, die], ...]); stops and returns false at the first step that is not legal.
  replay(wire) {
    this.reset();
    for (const [from, die] of wire) {
      const step = this.legal().find((s) => s.from === from && s.die === die);
      if (!step) return false;
      this.play(step);
    }
    return true;
  }

  wire() {
    return this.steps.map((s) => [s.from, s.die]);
  }
}

// The same moves with their destinations, for drawing a suggestion that was sent as [from, die] pairs.
export function withTargets(position, seat, wire) {
  const work = position.clone();
  const out = [];
  for (const [from, die] of wire) {
    const to = work.stepTarget(seat, from, die);
    if (to < 0) break;
    work.applyStep(seat, from, die, to);
    out.push([from, die, to]);
  }
  return out;
}
