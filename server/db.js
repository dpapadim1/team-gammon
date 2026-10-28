import Database from 'better-sqlite3';
import { PROVISIONAL_GAMES, START_RATING } from './ratings.js';

export const MIGRATIONS = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    sid TEXT PRIMARY KEY,
    expires INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX sessions_expires ON sessions(expires);
  CREATE TABLE games (
    id INTEGER PRIMARY KEY,
    room_id TEXT NOT NULL,
    variant TEXT NOT NULL,
    cycle TEXT NOT NULL,
    first_slot INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    time_minutes INTEGER NOT NULL,
    increment_sec INTEGER NOT NULL,
    seats TEXT NOT NULL,
    ended_at INTEGER,
    winner_team INTEGER,
    reason TEXT,
    history TEXT,
    final_position TEXT
  );
  CREATE TABLE game_players (
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seat TEXT NOT NULL,
    PRIMARY KEY (game_id, seat)
  );
  CREATE INDEX game_players_user ON game_players(user_id, game_id);
  CREATE TABLE chat_messages (
    id INTEGER PRIMARY KEY,
    room_id TEXT NOT NULL,
    game_id INTEGER REFERENCES games(id) ON DELETE SET NULL,
    ts INTEGER NOT NULL,
    principal TEXT NOT NULL,
    name TEXT NOT NULL,
    channel TEXT NOT NULL,
    text TEXT NOT NULL
  );
  CREATE INDEX chat_ts ON chat_messages(ts);
  `,
  `
  CREATE TABLE ratings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    rating REAL NOT NULL,
    games INTEGER NOT NULL,
    wins INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX ratings_rating ON ratings(rating DESC);
  ALTER TABLE game_players ADD COLUMN rating_before REAL;
  ALTER TABLE game_players ADD COLUMN rating_after REAL;
  `,
];

export function migrate(db) {
  let version = db.pragma('user_version', { simple: true });
  while (version < MIGRATIONS.length) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version]);
      db.pragma(`user_version = ${version + 1}`);
    })();
    version++;
  }
}

export function openStore(file = ':memory:') {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 3000');
  migrate(db);
  return new Store(db);
}

const standing = (r) => ({ rank: r.rank, name: r.name, rating: Math.round(r.rating), games: r.games, wins: r.wins, provisional: r.games < PROVISIONAL_GAMES });

export class Store {
  constructor(db) {
    this.db = db;
    const q = (sql) => db.prepare(sql);
    this.q = {
      createUser: q('INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)'),
      userByName: q('SELECT id, username, pass_hash FROM users WHERE username = ?'),
      userById: q('SELECT id, username, pass_hash FROM users WHERE id = ?'),
      deleteUser: q('DELETE FROM users WHERE id = ?'),
      getSession: q('SELECT expires, data FROM sessions WHERE sid = ?'),
      setSession: q('INSERT INTO sessions (sid, expires, data) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET expires = excluded.expires, data = excluded.data'),
      touchSession: q('UPDATE sessions SET expires = ? WHERE sid = ?'),
      destroySession: q('DELETE FROM sessions WHERE sid = ?'),
      purgeSessions: q('DELETE FROM sessions WHERE expires <= ?'),
      startGame: q(`INSERT INTO games (room_id, variant, cycle, first_slot, started_at, time_minutes, increment_sec, seats)
                    VALUES (@roomId, @variant, @cycle, @firstSlot, @startedAt, @timeMinutes, @incrementSec, @seats)`),
      addPlayer: q('INSERT INTO game_players (game_id, user_id, seat) VALUES (?, ?, ?)'),
      finishGame: q('UPDATE games SET ended_at = @endedAt, winner_team = @winnerTeam, reason = @reason, history = @history, final_position = @finalPosition WHERE id = @id'),
      abandon: q("UPDATE games SET ended_at = started_at, reason = 'abandoned' WHERE ended_at IS NULL"),
      getGame: q('SELECT * FROM games WHERE id = ?'),
      isPlayer: q('SELECT seat FROM game_players WHERE game_id = ? AND user_id = ?'),
      gamesOfUser: q(`SELECT g.id, g.variant, g.started_at, g.ended_at, g.winner_team, g.reason, gp.seat, gp.rating_before, gp.rating_after
                      FROM game_players gp JOIN games g ON g.id = gp.game_id
                      WHERE gp.user_id = ? AND g.ended_at IS NOT NULL AND g.id < ?
                      ORDER BY g.id DESC LIMIT ?`),
      playerGames: q('SELECT game_id, seat FROM game_players WHERE user_id = ?'),
      setSeats: q('UPDATE games SET seats = ? WHERE id = ?'),
      addChat: q('INSERT INTO chat_messages (room_id, game_id, ts, principal, name, channel, text) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      scrubChat: q("UPDATE chat_messages SET principal = 'deleted', name = 'deleted' WHERE principal = ?"),
      purgeChat: q('DELETE FROM chat_messages WHERE ts < ?'),
      ratingOf: q(`SELECT COALESCE(r.rating, ${START_RATING}) AS rating, COALESCE(r.games, 0) AS games, COALESCE(r.wins, 0) AS wins
                   FROM users u LEFT JOIN ratings r ON r.user_id = u.id WHERE u.id = ?`),
      upsertRating: q(`INSERT INTO ratings (user_id, rating, games, wins, updated_at) VALUES (@userId, @rating, 1, @won, @now)
                       ON CONFLICT(user_id) DO UPDATE SET rating = excluded.rating, games = games + 1, wins = wins + excluded.wins, updated_at = excluded.updated_at`),
      setGameRating: q('UPDATE game_players SET rating_before = ?, rating_after = ? WHERE game_id = ? AND seat = ?'),
      leaderboard: q(`SELECT u.username AS name, r.rating, r.games, r.wins, (SELECT COUNT(*) FROM ratings x WHERE x.rating > r.rating) + 1 AS rank
                      FROM ratings r JOIN users u ON u.id = r.user_id
                      ORDER BY r.rating DESC, r.games DESC, u.username LIMIT ?`),
      standingOf: q(`SELECT u.username AS name, r.rating, r.games, r.wins, (SELECT COUNT(*) FROM ratings x WHERE x.rating > r.rating) + 1 AS rank
                     FROM ratings r JOIN users u ON u.id = r.user_id WHERE r.user_id = ?`),
    };
  }

  close() {
    this.db.close();
  }

  // --- users -----------------------------------------------------------------

  createUser(username, passHash, now = Date.now()) {
    return Number(this.q.createUser.run(username, passHash, now).lastInsertRowid);
  }

  getUserByName(username) {
    return this.q.userByName.get(username);
  }

  getUserById(id) {
    return this.q.userById.get(id);
  }

  // Removes the account and the personal data attached to it; finished games stay but lose the name.
  deleteUser(id) {
    this.db.transaction(() => {
      for (const row of this.q.playerGames.all(id)) {
        const game = this.q.getGame.get(row.game_id);
        const seats = JSON.parse(game.seats);
        if (seats[row.seat]) seats[row.seat].name = 'deleted';
        this.q.setSeats.run(JSON.stringify(seats), row.game_id);
      }
      this.q.scrubChat.run(`u:${id}`);
      this.q.deleteUser.run(id);
    })();
  }

  // --- sessions --------------------------------------------------------------

  getSession(sid) {
    return this.q.getSession.get(sid);
  }

  setSession(sid, expires, data) {
    this.q.setSession.run(sid, expires, data);
  }

  touchSession(sid, expires) {
    this.q.touchSession.run(expires, sid);
  }

  destroySession(sid) {
    this.q.destroySession.run(sid);
  }

  purgeSessions(now = Date.now()) {
    return this.q.purgeSessions.run(now).changes;
  }

  // --- games -----------------------------------------------------------------

  startGame(info, players) {
    return this.db.transaction(() => {
      const id = Number(this.q.startGame.run({
        roomId: info.roomId,
        variant: info.variant,
        cycle: JSON.stringify(info.cycle),
        firstSlot: info.firstSlot,
        startedAt: info.startedAt,
        timeMinutes: info.timeMinutes,
        incrementSec: info.incrementSec,
        seats: JSON.stringify(info.seats),
      }).lastInsertRowid);
      for (const p of players) this.q.addPlayer.run(id, p.userId, p.seat);
      return id;
    })();
  }

  finishGame(id, result) {
    this.q.finishGame.run({
      id,
      endedAt: result.endedAt,
      winnerTeam: result.winnerTeam,
      reason: result.reason,
      history: JSON.stringify(result.history),
      finalPosition: result.finalPosition,
    });
  }

  abandonUnfinished() {
    return this.q.abandon.run().changes;
  }

  getGame(id) {
    const row = this.q.getGame.get(id);
    if (!row) return null;
    return {
      id: row.id,
      roomId: row.room_id,
      variant: row.variant,
      cycle: JSON.parse(row.cycle),
      firstSlot: row.first_slot,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      timeMinutes: row.time_minutes,
      incrementSec: row.increment_sec,
      seats: JSON.parse(row.seats),
      winnerTeam: row.winner_team,
      reason: row.reason,
      history: row.history ? JSON.parse(row.history) : null,
      finalPosition: row.final_position,
    };
  }

  seatOfPlayer(gameId, userId) {
    return this.q.isPlayer.get(gameId, userId)?.seat ?? null;
  }

  gamesOfUser(userId, { limit = 20, before = Number.MAX_SAFE_INTEGER } = {}) {
    return this.q.gamesOfUser.all(userId, before, Math.min(Math.max(limit, 1), 100)).map((r) => ({
      id: r.id,
      variant: r.variant,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      winnerTeam: r.winner_team,
      reason: r.reason,
      seat: r.seat,
      ratingBefore: r.rating_before === null ? null : Math.round(r.rating_before),
      ratingAfter: r.rating_after === null ? null : Math.round(r.rating_after),
    }));
  }

  // --- ratings ---------------------------------------------------------------

  // Current {rating, games, wins} of a registered user (new players start at START_RATING); null when the user does not exist.
  ratingOf(userId) {
    return this.q.ratingOf.get(userId) ?? null;
  }

  // Stores the outcome of one rated game for its registered players, in one transaction.
  saveRatings(gameId, changes, now = Date.now()) {
    this.db.transaction(() => {
      for (const c of changes) {
        this.q.upsertRating.run({ userId: c.userId, rating: c.after, won: c.won ? 1 : 0, now });
        this.q.setGameRating.run(c.before, c.after, gameId, c.seat);
      }
    })();
  }

  leaderboard({ limit = 50 } = {}) {
    return this.q.leaderboard.all(Math.min(Math.max(limit, 1), 100)).map(standing);
  }

  // Rank and record of one player, or null before their first rated game.
  standingOf(userId) {
    const row = this.q.standingOf.get(userId);
    return row ? standing(row) : null;
  }

  // --- chat ------------------------------------------------------------------

  addChat(message) {
    this.q.addChat.run(message.roomId, message.gameId ?? null, message.ts, message.principal, message.name, message.channel, message.text);
  }

  purgeChat(olderThan) {
    return this.q.purgeChat.run(olderThan).changes;
  }
}
