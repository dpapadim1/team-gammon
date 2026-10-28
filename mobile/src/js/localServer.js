import './shims/buffer.js';
import { createRng } from '../../engine/index.js';
import { buildConfig } from '../../server/config.js';
import { Room } from '../../server/room.js';
import { ProtocolError, fail } from '../../server/errors.js';
import { BOT_RATINGS } from '../../server/ratings.js';
import * as V from '../../server/validate.js';
import { BOT_LEVELS, createBotForLevel } from '../../bots/levels.js';
import { ValueNet } from '../../bots/nn.js';
import { NetError } from '../../client/js/net.js';
import { randomInt } from './shims/crypto.js';

const SOCKET_ID = 'local';
export const LOCAL_USER = Object.freeze({ id: 'local', uid: null, name: 'You', username: 'You', guest: true });

// The published value network for levels 8 and 9; without it those levels play like level 7.
export async function loadChampion(url = '/models/champion.json') {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return ValueNet.fromJSON(await res.json());
  } catch (err) {
    console.warn('bot network not loaded', err);
    return null;
  }
}

function rulesSummary(variant) {
  return {
    id: variant.id,
    numPoints: variant.numPoints,
    homeSize: variant.homeSize,
    checkersPerSeat: variant.checkersPerSeat,
    startSanctuary: variant.startSanctuary === true,
    seats: variant.seats.map((s) => ({ id: s.id, team: s.team, start: s.start, dir: s.dir })),
  };
}

// Nothing is stored on the device: offline games are unrated and not kept in a history.
function memoryStore() {
  let games = 0;
  return {
    ratingOf: () => null,
    startGame: () => ++games,
    finishGame() {},
    saveRatings() {},
    addChat() {},
  };
}

// Same interface as client/js/net.js, but the table runs in this page: the server's Room and GameSession
// drive the game and the bots, so offline play follows exactly the same rules and timing as online play.
export class LocalNet {
  constructor({ champion = null, now = Date.now } = {}) {
    this.config = buildConfig({}, {});
    this.listeners = new Map();
    this.room = null;
    this.online = false;
    this.services = {
      config: this.config,
      store: memoryStore(),
      rollDice: () => [randomInt(1, 7), randomInt(1, 7)],
      emit: (socketId, event, payload) => queueMicrotask(() => this.fire(event, payload)),
      now,
      createBot: (level) => createBotForLevel(level, createRng(randomInt(0, 2 ** 32)), { champion }),
      onEmpty: () => {},
    };
    this.hello = {
      protocol: 1,
      rules: rulesSummary(this.config.variant),
      botLevels: Object.fromEntries(Object.entries(BOT_LEVELS).map(([level, cfg]) => [level, cfg.label])),
      botRatings: { ...BOT_RATINGS },
      user: LOCAL_USER,
    };
    this.rulesId = this.config.variant.id;
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event).delete(fn);
  }

  fire(event, payload) {
    for (const fn of this.listeners.get(event) ?? []) fn(payload);
  }

  connect() {
    if (this.online) return;
    this.online = true;
    queueMicrotask(() => {
      this.fire('status', 'online');
      this.fire('hello', { ...this.hello, serverTime: this.services.now() });
    });
  }

  close() {
    this.room?.destroy();
    this.room = null;
    this.online = false;
  }

  withRoom(fn) {
    if (!this.room) fail('no_room');
    return fn(this.room);
  }

  handle(event, p) {
    const user = LOCAL_USER;
    const rules = this.room?.rules;
    switch (event) {
      case 'room:create': {
        const options = V.roomOptions(p, { creating: true });
        this.room?.destroy();
        this.room = new Room({ id: 'offline1', host: user, options, services: this.services });
        this.room.join(SOCKET_ID, user);
        return { roomId: this.room.id };
      }
      case 'room:leave':
        this.close();
        return undefined;
      case 'room:settings': return this.withRoom((r) => r.configure(user, V.roomOptions(p, { creating: false })));
      case 'seat:claim': return this.withRoom((r) => r.claim(user, V.seat(p.seat, rules)));
      case 'seat:release': return this.withRoom((r) => r.release(user, V.seat(p.seat, rules)));
      case 'seat:ready': return this.withRoom((r) => {
        if (typeof p.ready !== 'boolean') fail('bad_request');
        r.setReady(user, p.ready);
      });
      case 'bot:set': return this.withRoom((r) => r.setBot(user, V.seat(p.seat, rules), p.level === null ? null : V.level(p.level)));
      case 'bot:fill': return this.withRoom((r) => r.fillBots(user, V.level(p.level)));
      case 'turn:play': return this.withRoom((r) => r.playTurn(user, p.steps));
      case 'suggest:clear': return undefined;
      case 'chat:send': return this.withRoom((r) => r.chatMessage(user, p.text, p.channel));
      case 'game:resign': return this.withRoom((r) => r.resign(user));
      case 'game:rematch': return this.withRoom((r) => r.rematch(user));
      default: return fail('bad_request');
    }
  }

  // Answers asynchronously like the socket would, so the views see the same ordering of replies and state.
  request(event, payload = {}) {
    return new Promise((resolve, reject) => {
      let res;
      try {
        res = this.handle(event, payload ?? {});
      } catch (err) {
        if (err instanceof ProtocolError) {
          queueMicrotask(() => reject(new NetError(err.code)));
          return;
        }
        console.error(`offline ${event} failed`, err);
        queueMicrotask(() => reject(new NetError('internal')));
        return;
      }
      queueMicrotask(() => resolve({ ok: true, ...(res ?? {}) }));
    });
  }
}
