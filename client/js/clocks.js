// Interpolates the team clocks between server snapshots.
export class ClockModel {
  constructor(now = Date.now) {
    this.now = now;
    this.pools = [0, 0];
    this.running = null;
    this.anchor = 0;
  }

  // `serverTime` and `clocks.asOf` are on the server's clock; the offset moves them to the local clock.
  update(clocks, serverTime) {
    const offset = this.now() - serverTime;
    this.pools = clocks.pools.slice();
    this.running = clocks.running;
    this.anchor = clocks.asOf + offset;
  }

  remaining(team, at = this.now()) {
    const charged = this.running === team ? Math.max(0, at - this.anchor) : 0;
    return Math.max(0, this.pools[team] - charged);
  }
}
