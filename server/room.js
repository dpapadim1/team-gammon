import { randomInt } from 'node:crypto';
import { compileVariant, stepsToWire, validateTurn } from '../engine/index.js';
import { BOT_LEVELS } from '../bots/levels.js';
import { GameSession } from './gameSession.js';
import { fail } from './errors.js';
import { BOT_RATINGS, START_RATING, isRated, rateGame } from './ratings.js';
import * as V from './validate.js';

// One table: members, seats, readiness, bots, chat and the current game. Transport-free: output goes through services.emit.
export class Room {
  constructor({ id, host, options, services }) {
    this.services = services;
    this.id = id;
    this.rules = compileVariant(services.config.variant);
    this.name = options.name ?? `${host.name}'s room`;
    this.visibility = options.visibility ?? 'public';
    this.timeMinutes = options.timeMinutes ?? services.config.game.timeMinutes;
    this.incrementSec = options.incrementSec ?? services.config.game.incrementSec;
    this.createdBy = host.id;
    this.hostId = host.id;
    this.hostName = host.name;
    this.members = new Map();
    this.seats = new Map(this.rules.seatIds.map((seat) => [seat, null]));
    this.phase = 'lobby';
    this.session = null;
    this.dbGameId = null;
    this.version = 0;
    this.chat = [];
    this.chatSeq = 0;
    this.suggestions = new Map();
    this.emptySince = services.now();
  }

  // --- lookups ---------------------------------------------------------------

  seatOf(userId) {
    for (const [seat, s] of this.seats) if (s && s.kind === 'human' && s.userId === userId) return seat;
    return null;
  }

  teamOfSeat(seat) {
    return this.rules.teamOf[this.rules.seatIndex.get(seat)];
  }

  userPresent(userId) {
    for (const u of this.members.values()) if (u.id === userId) return true;
    return false;
  }

  requireHost(user) {
    if (user.id !== this.hostId) fail('not_host');
  }

  requireLobby() {
    if (this.phase !== 'lobby') fail('not_lobby');
  }

  // --- membership ------------------------------------------------------------

  join(socketId, user) {
    if (!this.members.has(socketId) && this.members.size >= this.services.config.limits.membersPerRoom) fail('room_full');
    this.members.set(socketId, user);
    this.emptySince = null;
    this.ensureHost();
    this.services.emit(socketId, 'chat:history', { messages: this.visibleChat(user) });
    this.broadcast();
  }

  // An explicit leave is refused while the user's seat is in a running game; a dropped connection just keeps the seat.
  leave(socketId, { explicit = false } = {}) {
    const user = this.members.get(socketId);
    if (!user) return;
    const seat = this.seatOf(user.id);
    const lastSocket = ![...this.members].some(([sid, u]) => sid !== socketId && u.id === user.id);
    if (explicit && seat && lastSocket && this.phase === 'playing') fail('in_game');
    this.members.delete(socketId);
    if (lastSocket && seat && this.phase !== 'playing') this.seats.set(seat, null);
    if (this.members.size === 0) {
      this.emptySince = this.services.now();
      if (this.phase === 'lobby') this.services.onEmpty(this);
      return;
    }
    this.ensureHost();
    this.broadcast();
  }

  // Host duties pass to a present member (seated humans first) when the host is gone.
  ensureHost() {
    if (this.userPresent(this.hostId)) return;
    const seated = [...this.seats.values()].find((s) => s && s.kind === 'human' && this.userPresent(s.userId));
    const next = seated ? [...this.members.values()].find((u) => u.id === seated.userId) : [...this.members.values()][0];
    if (next) {
      this.hostId = next.id;
      this.hostName = next.name;
    }
  }

  // --- lobby -----------------------------------------------------------------

  claim(user, seatId) {
    this.requireLobby();
    const occupant = this.seats.get(seatId);
    if (occupant && occupant.kind === 'human' && occupant.userId !== user.id) fail('seat_taken');
    const current = this.seatOf(user.id);
    if (current === seatId) return;
    if (current) this.seats.set(current, null);
    this.seats.set(seatId, { kind: 'human', userId: user.id, uid: user.uid ?? null, name: user.name, ready: false, rating: this.ratingFor(user.uid) });
    this.afterLobbyChange();
  }

  release(user, seatId) {
    this.requireLobby();
    const s = this.seats.get(seatId);
    if (!s || s.kind !== 'human' || s.userId !== user.id) fail('no_seat');
    this.seats.set(seatId, null);
    this.broadcast();
  }

  setReady(user, ready) {
    this.requireLobby();
    const seat = this.seatOf(user.id);
    if (!seat) fail('no_seat');
    this.seats.get(seat).ready = ready;
    this.afterLobbyChange();
  }

  setBot(user, seatId, level) {
    this.requireHost(user);
    this.requireLobby();
    const occupant = this.seats.get(seatId);
    if (occupant && occupant.kind === 'human') fail('human_seat');
    this.seats.set(seatId, level === null ? null : this.makeBot(level));
    this.afterLobbyChange();
  }

  fillBots(user, level) {
    this.requireHost(user);
    this.requireLobby();
    for (const [seat, s] of this.seats) if (!s) this.seats.set(seat, this.makeBot(level));
    this.afterLobbyChange();
  }

  makeBot(level) {
    return { kind: 'bot', level, name: `${BOT_LEVELS[level].label} bot`, bot: this.services.createBot(level) };
  }

  // Rounded rating of a registered user; guests have none.
  ratingFor(uid) {
    if (uid === null || uid === undefined) return null;
    const row = this.services.store.ratingOf(uid);
    return row ? Math.round(row.rating) : null;
  }

  configure(user, options) {
    this.requireHost(user);
    this.requireLobby();
    Object.assign(this, options);
    this.broadcast();
  }

  afterLobbyChange() {
    if (!this.maybeStart()) this.broadcast();
  }

  maybeStart() {
    if (this.phase !== 'lobby') return false;
    let humans = 0;
    for (const s of this.seats.values()) {
      if (!s) return false;
      if (s.kind === 'human') {
        humans++;
        if (!s.ready || !this.userPresent(s.userId)) return false;
      }
    }
    if (humans === 0) return false;
    this.startGame();
    return true;
  }

  // --- game ------------------------------------------------------------------

  seatRecord() {
    const out = {};
    for (const [seat, s] of this.seats) out[seat] = s.kind === 'bot' ? { kind: 'bot', name: s.name, level: s.level } : { kind: 'human', name: s.name };
    return out;
  }

  startGame() {
    const { config, store, now, rollDice } = this.services;
    const reversed = randomInt(2) === 1;
    const firstSlot = randomInt(this.rules.S);
    const controllers = this.rules.seatIds.map((id) => {
      const s = this.seats.get(id);
      return s.kind === 'bot' ? { kind: 'bot', bot: s.bot } : { kind: 'human' };
    });
    this.session = new GameSession({
      variant: config.variant,
      reversed,
      firstSlot,
      controllers,
      rollDice,
      poolMs: this.timeMinutes * config.clockUnits.minuteMs,
      incrementMs: this.incrementSec * config.clockUnits.secondMs,
      timing: config.timing,
      now,
      onChange: () => this.onGameChanged(),
      onOver: () => this.onGameOver(),
    });
    this.phase = 'playing';
    this.suggestions.clear();
    for (const s of this.seats.values()) if (s.kind === 'human') s.rating = this.ratingFor(s.uid);
    const players = [];
    for (const [seat, s] of this.seats) if (s.kind === 'human' && s.uid !== null) players.push({ userId: s.uid, seat });
    this.dbGameId = store.startGame({
      roomId: this.id,
      variant: config.variant.id,
      cycle: this.session.cycleIds(),
      firstSlot,
      startedAt: now(),
      timeMinutes: this.timeMinutes,
      incrementSec: this.incrementSec,
      seats: this.seatRecord(),
    }, players);
    this.broadcast();
    this.session.start();
  }

  onGameChanged() {
    const turn = this.session.game.turnNumber;
    for (const [seat, s] of this.suggestions) if (s.turnNumber !== turn) this.suggestions.delete(seat);
    this.broadcast();
  }

  onGameOver() {
    this.phase = 'over';
    this.suggestions.clear();
    this.persistResult();
    this.applyRatings();
    this.broadcast();
  }

  // Registered players get their new rating; it goes into the result so the clients can show the change.
  applyRatings() {
    const s = this.session;
    if (!s || this.dbGameId === null || !isRated(s.result.reason, s.game.turnNumber)) return;
    const { store, now } = this.services;
    try {
      const entries = this.rules.seatIds.map((seat) => {
        const occupant = this.seats.get(seat);
        const base = { seat, team: this.teamOfSeat(seat) };
        if (occupant.kind === 'bot') return { ...base, rating: BOT_RATINGS[occupant.level] };
        const row = occupant.uid === null ? null : store.ratingOf(occupant.uid);
        return row ? { ...base, rating: row.rating, userId: occupant.uid, games: row.games } : { ...base, rating: START_RATING };
      });
      const changes = rateGame(entries, s.result.winnerTeam);
      if (changes.length === 0) return;
      store.saveRatings(this.dbGameId, changes, now());
      const ratings = {};
      for (const c of changes) {
        ratings[c.seat] = { before: Math.round(c.before), after: Math.round(c.after) };
        this.seats.get(c.seat).rating = ratings[c.seat].after;
      }
      s.result = { ...s.result, ratings };
    } catch (err) {
      console.error('could not update the ratings', err);
    }
  }

  persistResult() {
    const s = this.session;
    if (!s || this.dbGameId === null) return;
    try {
      this.services.store.finishGame(this.dbGameId, {
        endedAt: this.services.now(),
        winnerTeam: s.result.winnerTeam,
        reason: s.result.reason,
        history: s.game.history,
        finalPosition: s.game.position.toText(),
      });
    } catch (err) {
      console.error('could not save the finished game', err);
    }
  }

  playTurn(user, wireSteps) {
    if (this.phase !== 'playing') fail('no_game');
    const seat = this.seatOf(user.id);
    if (!seat) fail('no_seat');
    const steps = V.steps(wireSteps, this.rules);
    this.session.playTurn(this.rules.seatIndex.get(seat), steps);
  }

  resign(user) {
    if (this.phase !== 'playing') fail('no_game');
    const seat = this.seatOf(user.id);
    if (!seat) fail('no_seat');
    this.session.resign(this.teamOfSeat(seat));
  }

  // Back to the lobby with the same seats; humans who left lose their seat.
  rematch(user) {
    if (this.phase !== 'over') fail('no_game');
    if (!this.seatOf(user.id) && user.id !== this.hostId) fail('no_seat');
    for (const [seat, s] of this.seats) {
      if (!s || s.kind === 'bot') continue;
      if (this.userPresent(s.userId)) s.ready = false;
      else this.seats.set(seat, null);
    }
    this.session = null;
    this.dbGameId = null;
    this.phase = 'lobby';
    this.ensureHost();
    this.broadcast();
  }

  // --- collaboration ---------------------------------------------------------

  chatMessage(user, textRaw, channelRaw) {
    const text = V.text(textRaw, { max: 300 });
    const channel = V.channel(channelRaw);
    const seat = this.seatOf(user.id);
    let team = null;
    if (channel === 'team') {
      if (!seat) fail('no_seat');
      team = this.teamOfSeat(seat);
    }
    const message = { id: ++this.chatSeq, ts: this.services.now(), from: { name: user.name, seat }, channel, text, team };
    this.chat.push(message);
    if (this.chat.length > this.services.config.limits.chatMessages) this.chat.shift();
    try {
      this.services.store.addChat({ roomId: this.id, gameId: this.dbGameId, ts: message.ts, principal: user.id, name: user.name, channel, text });
    } catch (err) {
      console.error('could not save chat message', err);
    }
    for (const [sid, member] of this.members) {
      if (this.canSee(message, member)) this.services.emit(sid, 'chat', this.publicMessage(message));
    }
  }

  canSee(message, user) {
    if (message.channel === 'all') return true;
    const seat = this.seatOf(user.id);
    return seat !== null && this.teamOfSeat(seat) === message.team;
  }

  publicMessage(m) {
    return { id: m.id, ts: m.ts, from: m.from, channel: m.channel, text: m.text };
  }

  visibleChat(user) {
    return this.chat.filter((m) => this.canSee(m, user)).slice(-50).map((m) => this.publicMessage(m));
  }

  // A teammate of the player on turn can sketch a legal turn; only that team sees it.
  suggest(user, wireSteps) {
    if (this.phase !== 'playing') fail('no_game');
    const seatId = this.seatOf(user.id);
    if (!seatId) fail('no_seat');
    const g = this.session.game;
    const R = this.rules;
    const idx = R.seatIndex.get(seatId);
    if (g.phase !== 'move' || idx === g.actor || R.teamOf[idx] !== R.teamOf[g.actor]) fail('not_your_turn');
    const steps = V.steps(wireSteps, R);
    const check = validateTurn(g.position, g.actor, g.dice, steps);
    if (!check.ok) fail('illegal_turn', check.error);
    this.suggestions.set(seatId, { steps: stepsToWire(steps), turnNumber: g.turnNumber });
    this.broadcast();
  }

  clearSuggestion(user) {
    const seatId = this.seatOf(user.id);
    if (seatId && this.suggestions.delete(seatId)) this.broadcast();
  }

  // --- output ----------------------------------------------------------------

  shared() {
    const seats = {};
    for (const [id, s] of this.seats) {
      seats[id] = s && (s.kind === 'bot'
        ? { kind: 'bot', name: s.name, ready: true, connected: true, level: s.level }
        : { kind: 'human', name: s.name, ready: s.ready, connected: this.userPresent(s.userId), ...(typeof s.rating === 'number' ? { rating: s.rating } : {}) });
    }
    let spectators = 0;
    for (const u of this.members.values()) if (!this.seatOf(u.id)) spectators++;
    return {
      version: this.version,
      serverTime: this.services.now(),
      room: { id: this.id, name: this.name, visibility: this.visibility, host: this.hostName, timeMinutes: this.timeMinutes, incrementSec: this.incrementSec },
      phase: this.phase,
      seats,
      spectators,
      game: this.session ? { ...this.session.snapshot(), gameId: this.dbGameId } : null,
    };
  }

  youFor(user) {
    const seat = this.seatOf(user.id);
    const suggestions = [];
    if (seat) {
      const team = this.teamOfSeat(seat);
      for (const [from, s] of this.suggestions) if (this.teamOfSeat(from) === team) suggestions.push({ seat: from, steps: s.steps, turnNumber: s.turnNumber });
    }
    return { seat, host: user.id === this.hostId, suggestions };
  }

  broadcast() {
    this.version++;
    const shared = this.shared();
    for (const [sid, user] of this.members) this.services.emit(sid, 'state', { ...shared, you: this.youFor(user) });
  }

  summary() {
    let humans = 0;
    let bots = 0;
    for (const s of this.seats.values()) {
      if (s?.kind === 'human') humans++;
      else if (s?.kind === 'bot') bots++;
    }
    return { id: this.id, name: this.name, host: this.hostName, humans, bots, phase: this.phase, timeMinutes: this.timeMinutes, incrementSec: this.incrementSec };
  }

  // A game that is still running when its room disappears is recorded as abandoned.
  destroy() {
    if (this.session && this.phase === 'playing') {
      this.session.stop();
      this.session.result = { winnerTeam: -1, reason: 'abandoned' };
      this.persistResult();
    }
    this.session?.stop();
  }
}
