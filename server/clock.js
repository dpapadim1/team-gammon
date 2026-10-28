// Shared team pools with a per-turn increment. Only one team is charged at a time.
export class TeamClock {
  constructor({ poolMs, incrementMs, now = Date.now }) {
    this.pools = [poolMs, poolMs];
    this.incrementMs = incrementMs;
    this.now = now;
    this.running = null;
    this.since = 0;
  }

  start(team) {
    this.stop();
    this.running = team;
    this.since = this.now();
  }

  stop() {
    if (this.running === null) return;
    this.pools[this.running] = this.remaining(this.running);
    this.running = null;
  }

  remaining(team) {
    const charged = this.running === team ? this.now() - this.since : 0;
    return Math.max(0, this.pools[team] - charged);
  }

  addIncrement(team) {
    this.pools[team] += this.incrementMs;
  }

  snapshot() {
    return { pools: [this.remaining(0), this.remaining(1)], running: this.running, asOf: this.now() };
  }
}
