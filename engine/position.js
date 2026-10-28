export const OFF = 0;
export const BLOCKED = -1;

const TOKEN = /^([A-Za-z][A-Za-z0-9_]*):(\d+)(!?)$/;

export class Position {
  constructor(rules) {
    this.rules = rules;
    this.counts = new Int8Array((rules.N + 1) * rules.S);
    this.pinned = new Int8Array(rules.N + 1).fill(-1);
    this.off = new Int8Array(rules.S);
    this.hLo = 0;
    this.hHi = 0;
  }

  static initial(rules) {
    const pos = new Position(rules);
    for (let s = 0; s < rules.S; s++) pos._setCount(rules.startPoint[s], s, rules.checkersPerSeat);
    return pos;
  }

  clone() {
    const c = new Position(this.rules);
    c.counts.set(this.counts);
    c.pinned.set(this.pinned);
    c.off.set(this.off);
    c.hLo = this.hLo;
    c.hHi = this.hHi;
    return c;
  }

  // --- hashing -------------------------------------------------------------

  key() {
    return (this.hHi & 0x1fffff) * 4294967296 + (this.hLo >>> 0);
  }

  recomputeHash() {
    const R = this.rules;
    const z = R.zobrist;
    const width = z.maxCount + 1;
    let lo = 0;
    let hi = 0;
    for (let p = 1; p <= R.N; p++) {
      for (let s = 0; s < R.S; s++) {
        const c = this.counts[p * R.S + s];
        if (c) {
          const i = (p * R.S + s) * width + c;
          lo ^= z.count.lo[i];
          hi ^= z.count.hi[i];
        }
      }
      const pin = this.pinned[p];
      if (pin >= 0) {
        const i = p * (R.S + 1) + pin + 1;
        lo ^= z.pin.lo[i];
        hi ^= z.pin.hi[i];
      }
    }
    for (let s = 0; s < R.S; s++) {
      const n = this.off[s];
      if (n) {
        lo ^= z.off.lo[s * width + n];
        hi ^= z.off.hi[s * width + n];
      }
    }
    return { lo, hi };
  }

  _setCount(p, s, n) {
    const R = this.rules;
    const z = R.zobrist;
    const i = p * R.S + s;
    const base = i * (z.maxCount + 1);
    const old = this.counts[i];
    this.hLo ^= z.count.lo[base + old] ^ z.count.lo[base + n];
    this.hHi ^= z.count.hi[base + old] ^ z.count.hi[base + n];
    this.counts[i] = n;
  }

  _setPin(p, seat) {
    const R = this.rules;
    const z = R.zobrist;
    const base = p * (R.S + 1);
    const old = this.pinned[p];
    this.hLo ^= z.pin.lo[base + old + 1] ^ z.pin.lo[base + seat + 1];
    this.hHi ^= z.pin.hi[base + old + 1] ^ z.pin.hi[base + seat + 1];
    this.pinned[p] = seat;
  }

  _setOff(s, n) {
    const z = this.rules.zobrist;
    const base = s * (z.maxCount + 1);
    const old = this.off[s];
    this.hLo ^= z.off.lo[base + old] ^ z.off.lo[base + n];
    this.hHi ^= z.off.hi[base + old] ^ z.off.hi[base + n];
    this.off[s] = n;
  }

  // --- queries -------------------------------------------------------------

  countAt(p, s) {
    return this.counts[p * this.rules.S + s];
  }

  teamCountAt(p, team) {
    const R = this.rules;
    const seats = R.teamSeats[team];
    let c = 0;
    for (let i = 0; i < seats.length; i++) c += this.counts[p * R.S + seats[i]];
    return c;
  }

  checkersOnBoard(s) {
    const R = this.rules;
    let c = 0;
    for (let p = 1; p <= R.N; p++) c += this.counts[p * R.S + s];
    return c;
  }

  pipsLeft(s) {
    const R = this.rules;
    let sum = 0;
    for (let p = 1; p <= R.N; p++) {
      const c = this.counts[p * R.S + s];
      if (c) sum += c * R.dist[s][p];
    }
    return sum;
  }

  isFinished(s) {
    return this.off[s] === this.rules.checkersPerSeat;
  }

  teamFinished(team) {
    const seats = this.rules.teamSeats[team];
    for (let i = 0; i < seats.length; i++) if (!this.isFinished(seats[i])) return false;
    return true;
  }

  // Bear-off needs every remaining checker of the seat in its home board (pinned ones included).
  allHome(s) {
    const R = this.rules;
    const out = R.outside[s];
    for (let i = 0; i < out.length; i++) if (this.counts[out[i] * R.S + s] > 0) return false;
    return true;
  }

  _hasFartherThan(s, r) {
    const R = this.rules;
    for (let rr = r + 1; rr <= R.homeSize; rr++) if (this.counts[R.pointAt[s][rr] * R.S + s] > 0) return true;
    return false;
  }

  // A point is open to `s` if it has no enemy, one lone enemy checker (pin), or enemy checkers that are pinned by our team.
  _canLand(s, q) {
    const R = this.rules;
    const team = R.teamOf[s];
    const foes = R.teamSeats[1 - team];
    let enemy = 0;
    let lone = -1;
    for (let i = 0; i < foes.length; i++) {
      const c = this.counts[q * R.S + foes[i]];
      if (c > 0) {
        enemy += c;
        lone = foes[i];
      }
    }
    if (enemy === 0) return true;
    const pin = this.pinned[q];
    if (pin >= 0) return R.teamOf[pin] !== team;
    if (enemy !== 1) return false;
    return !(R.startSanctuary && R.startPoint[lone] === q);
  }

  // Target point of a step, OFF when it bears a checker off, BLOCKED when illegal.
  stepTarget(s, from, die) {
    const R = this.rules;
    if (this.counts[from * R.S + s] === 0 || this.pinned[from] === s) return BLOCKED;
    const r = R.dist[s][from];
    const nr = r - die;
    if (nr >= 1) {
      const q = R.pointAt[s][nr];
      return this._canLand(s, q) ? q : BLOCKED;
    }
    if (!this.allHome(s)) return BLOCKED;
    if (nr < 0 && this._hasFartherThan(s, r)) return BLOCKED;
    return OFF;
  }

  legalFroms(s, die) {
    const R = this.rules;
    const order = R.scanOrder[s];
    const out = [];
    for (let i = 0; i < order.length; i++) {
      const p = order[i];
      if (this.counts[p * R.S + s] > 0 && this.stepTarget(s, p, die) !== BLOCKED) out.push(p);
    }
    return out;
  }

  // --- mutation ------------------------------------------------------------

  applyStep(s, from, die, to = this.stepTarget(s, from, die)) {
    const R = this.rules;
    if (to === BLOCKED) throw new Error(`illegal step: seat ${R.seatIds[s]} from ${from} with ${die}`);
    const S = R.S;
    const rec = {
      s,
      from,
      to,
      pinFrom: this.pinned[from],
      pinTo: to === OFF ? -1 : this.pinned[to],
      hLo: this.hLo,
      hHi: this.hHi,
    };
    const team = R.teamOf[s];
    this._setCount(from, s, this.counts[from * S + s] - 1);
    if (this.pinned[from] >= 0 && this.teamCountAt(from, team) === 0) this._setPin(from, -1);
    if (to === OFF) {
      this._setOff(s, this.off[s] + 1);
    } else {
      if (this.pinned[to] < 0) {
        const foes = R.teamSeats[1 - team];
        let enemy = 0;
        let lone = -1;
        for (let i = 0; i < foes.length; i++) {
          const c = this.counts[to * S + foes[i]];
          if (c > 0) {
            enemy += c;
            lone = foes[i];
          }
        }
        if (enemy === 1) this._setPin(to, lone);
      }
      this._setCount(to, s, this.counts[to * S + s] + 1);
    }
    return rec;
  }

  undoStep(rec) {
    const S = this.rules.S;
    const { s, from, to } = rec;
    if (to === OFF) {
      this.off[s]--;
    } else {
      this.counts[to * S + s]--;
      this.pinned[to] = rec.pinTo;
    }
    this.counts[from * S + s]++;
    this.pinned[from] = rec.pinFrom;
    this.hLo = rec.hLo;
    this.hHi = rec.hHi;
  }

  // --- text form -----------------------------------------------------------
  // "<p1>/<p2>/.../<pN> <off per seat>"; a point is "." or "seat:count" tokens joined by "+", "!" marks the pinned seat.

  toText() {
    const R = this.rules;
    const parts = [];
    for (let p = 1; p <= R.N; p++) {
      const tokens = [];
      for (let s = 0; s < R.S; s++) {
        const c = this.counts[p * R.S + s];
        if (c > 0) tokens.push(`${R.seatIds[s]}:${c}${this.pinned[p] === s ? '!' : ''}`);
      }
      parts.push(tokens.length ? tokens.join('+') : '.');
    }
    return `${parts.join('/')} ${Array.from(this.off).join(',')}`;
  }

  toString() {
    return this.toText();
  }

  static fromText(rules, text) {
    const fields = text.trim().split(/\s+/);
    if (fields.length !== 2) throw new Error('position text needs "<points> <off counts>"');
    const points = fields[0].split('/');
    if (points.length !== rules.N) throw new Error(`expected ${rules.N} points, got ${points.length}`);
    const offs = fields[1].split(',').map(Number);
    if (offs.length !== rules.S || offs.some((n) => !Number.isInteger(n) || n < 0 || n > rules.checkersPerSeat)) {
      throw new Error('bad off counts');
    }
    const pos = new Position(rules);
    points.forEach((field, i) => {
      if (field === '.') return;
      const p = i + 1;
      for (const token of field.split('+')) {
        const m = TOKEN.exec(token);
        if (!m) throw new Error(`bad token ${JSON.stringify(token)} at point ${p}`);
        const s = rules.seatIndex.get(m[1]);
        const n = Number(m[2]);
        if (s === undefined) throw new Error(`unknown seat ${m[1]}`);
        if (n < 1 || n > rules.checkersPerSeat || pos.counts[p * rules.S + s] !== 0) throw new Error(`bad count in ${token}`);
        pos._setCount(p, s, n);
        if (m[3]) {
          if (pos.pinned[p] >= 0) throw new Error(`two pinned seats at point ${p}`);
          pos._setPin(p, s);
        }
      }
    });
    offs.forEach((n, s) => pos._setOff(s, n));
    return pos;
  }

  sameAs(other) {
    if (this.rules !== other.rules) return false;
    for (let i = 0; i < this.counts.length; i++) if (this.counts[i] !== other.counts[i]) return false;
    for (let i = 0; i < this.pinned.length; i++) if (this.pinned[i] !== other.pinned[i]) return false;
    for (let i = 0; i < this.off.length; i++) if (this.off[i] !== other.off[i]) return false;
    return true;
  }

  // Returns a list of broken invariants (empty when consistent).
  checkInvariants({ conservation = true } = {}) {
    const R = this.rules;
    const errors = [];
    for (let s = 0; s < R.S; s++) {
      let onBoard = 0;
      for (let p = 1; p <= R.N; p++) {
        const c = this.counts[p * R.S + s];
        if (c < 0) errors.push(`negative count: seat ${R.seatIds[s]} point ${p}`);
        onBoard += c;
      }
      if (this.off[s] < 0) errors.push(`negative off count: seat ${R.seatIds[s]}`);
      if (conservation && onBoard + this.off[s] !== R.checkersPerSeat) {
        errors.push(`seat ${R.seatIds[s]}: ${onBoard} on board + ${this.off[s]} off != ${R.checkersPerSeat}`);
      }
    }
    for (let p = 1; p <= R.N; p++) {
      const t0 = this.teamCountAt(p, 0);
      const t1 = this.teamCountAt(p, 1);
      const pin = this.pinned[p];
      if (t0 > 0 && t1 > 0) {
        if (pin < 0) {
          errors.push(`point ${p}: both teams present without a pin`);
        } else {
          const pinnedTeam = R.teamOf[pin];
          if (this.teamCountAt(p, pinnedTeam) !== 1 || this.counts[p * R.S + pin] !== 1) {
            errors.push(`point ${p}: pinned team must have exactly the pinned checker`);
          }
        }
      } else if (pin >= 0) {
        errors.push(`point ${p}: pin marker without both teams present`);
      }
    }
    const h = this.recomputeHash();
    if (h.lo !== this.hLo || h.hi !== this.hHi) errors.push('incremental hash out of sync');
    return errors;
  }
}
