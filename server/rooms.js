import { randomBytes } from 'node:crypto';
import { createRng } from '../engine/index.js';
import { createBotForLevel } from '../bots/levels.js';
import { Room } from './room.js';
import { fail } from './errors.js';

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function newRoomId() {
  return Array.from(randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export class RoomManager {
  constructor({ config, store, rollDice, emit, now = Date.now }) {
    this.config = config;
    this.rooms = new Map();
    this.services = {
      config,
      store,
      rollDice,
      emit,
      now,
      createBot: (level) => createBotForLevel(level, createRng(randomBytes(4).readUInt32LE(0))),
    };
  }

  create(user, options) {
    const { limits } = this.config;
    if (this.rooms.size >= limits.roomsTotal) fail('too_many_rooms');
    let mine = 0;
    for (const room of this.rooms.values()) if (room.createdBy === user.id) mine++;
    if (mine >= limits.roomsPerUser) fail('too_many_rooms');
    let id = newRoomId();
    while (this.rooms.has(id)) id = newRoomId();
    const room = new Room({ id, host: user, options, services: { ...this.services, onEmpty: (r) => this.remove(r.id) } });
    this.rooms.set(id, room);
    return room;
  }

  get(id) {
    return id ? this.rooms.get(id) ?? null : null;
  }

  remove(id) {
    const room = this.rooms.get(id);
    if (!room) return;
    room.destroy();
    this.rooms.delete(id);
  }

  // The room in which the user still holds a seat of a running game.
  roomOfUser(userId) {
    for (const room of this.rooms.values()) if (room.phase === 'playing' && room.seatOf(userId)) return room;
    return null;
  }

  listPublic() {
    return [...this.rooms.values()].filter((r) => r.visibility === 'public').map((r) => r.summary());
  }

  sweep(now = Date.now()) {
    for (const room of [...this.rooms.values()]) {
      if (room.members.size === 0 && room.emptySince !== null && now - room.emptySince >= this.config.roomIdleMs) this.remove(room.id);
    }
  }

  closeAll() {
    for (const id of [...this.rooms.keys()]) this.remove(id);
  }
}
