import { Server } from 'socket.io';
import { compileVariant } from '../engine/index.js';
import { BOT_LEVELS } from '../bots/levels.js';
import { BOT_RATINGS } from './ratings.js';
import { publicUser } from './auth.js';
import { ProtocolError, fail } from './errors.js';
import { TokenBucket } from './ratelimit.js';
import * as V from './validate.js';

export const PROTOCOL_VERSION = 1;

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

export function attachSockets({ httpServer, config, rooms, sessionMiddleware, originAllowed }) {
  const rules = compileVariant(config.variant);
  const hello = {
    protocol: PROTOCOL_VERSION,
    rules: rulesSummary(config.variant),
    botLevels: Object.fromEntries(Object.entries(BOT_LEVELS).map(([level, cfg]) => [level, cfg.label])),
    botRatings: { ...BOT_RATINGS },
  };

  const io = new Server(httpServer, {
    cors: config.allowedOrigins.length ? { origin: config.allowedOrigins, credentials: true } : undefined,
    allowRequest: (req, cb) => cb(null, originAllowed(req.headers.origin, req.headers.host)),
    maxHttpBufferSize: 16 * 1024,
  });
  io.engine.use(sessionMiddleware);
  io.use((socket, next) => {
    const user = socket.request.session?.user;
    if (!user) return next(new Error('auth_required'));
    let open = 0;
    for (const other of io.sockets.sockets.values()) if (other.data.user?.id === user.id) open++;
    if (open >= config.limits.socketsPerUser) return next(new Error('too_many_connections'));
    socket.data.user = user;
    return next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    const general = new TokenBucket({ capacity: 30, refillPerSec: 15 });
    const chatBucket = new TokenBucket({ capacity: 5, refillPerSec: 0.5 });
    let violations = 0;

    const currentRoom = () => rooms.get(socket.data.roomId);
    const withRoom = (fn) => {
      const room = currentRoom();
      if (!room) fail('no_room');
      return fn(room);
    };
    const join = (room) => {
      room.join(socket.id, user);
      socket.data.roomId = room.id;
    };
    const leaveCurrent = () => {
      currentRoom()?.leave(socket.id, { explicit: true });
      socket.data.roomId = null;
    };

    const handle = (event, fn, bucket = general) => {
      socket.on(event, (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        if (!bucket.take()) {
          if (++violations > 60) socket.disconnect(true);
          return reply({ ok: false, error: 'rate_limited' });
        }
        try {
          if (payload !== undefined && (payload === null || typeof payload !== 'object' || Array.isArray(payload))) fail('bad_request');
          return reply({ ok: true, ...(fn(payload ?? {}) ?? {}) });
        } catch (err) {
          if (err instanceof ProtocolError) return reply({ ok: false, error: err.code, message: err.message });
          console.error(`socket event ${event} failed`, err);
          return reply({ ok: false, error: 'internal' });
        }
      });
    };

    handle('room:create', (p) => {
      const options = V.roomOptions(p, { creating: true });
      leaveCurrent();
      const room = rooms.create(user, options);
      join(room);
      return { roomId: room.id };
    });
    handle('room:join', (p) => {
      const id = V.roomId(p.roomId);
      const room = rooms.get(id);
      if (!room) fail('no_room');
      if (socket.data.roomId === id) return {};
      leaveCurrent();
      join(room);
      return {};
    });
    handle('room:leave', () => {
      leaveCurrent();
    });
    handle('room:settings', (p) => withRoom((r) => r.configure(user, V.roomOptions(p, { creating: false }))));
    handle('seat:claim', (p) => withRoom((r) => r.claim(user, V.seat(p.seat, rules))));
    handle('seat:release', (p) => withRoom((r) => r.release(user, V.seat(p.seat, rules))));
    handle('seat:ready', (p) => withRoom((r) => {
      if (typeof p.ready !== 'boolean') fail('bad_request');
      r.setReady(user, p.ready);
    }));
    handle('bot:set', (p) => withRoom((r) => r.setBot(user, V.seat(p.seat, rules), p.level === null ? null : V.level(p.level))));
    handle('bot:fill', (p) => withRoom((r) => r.fillBots(user, V.level(p.level))));
    handle('turn:play', (p) => withRoom((r) => r.playTurn(user, p.steps)));
    handle('suggest:set', (p) => withRoom((r) => r.suggest(user, p.steps)));
    handle('suggest:clear', () => withRoom((r) => r.clearSuggestion(user)));
    handle('chat:send', (p) => withRoom((r) => r.chatMessage(user, p.text, p.channel)), chatBucket);
    handle('game:resign', () => withRoom((r) => r.resign(user)));
    handle('game:rematch', () => withRoom((r) => r.rematch(user)));

    socket.on('disconnect', () => {
      currentRoom()?.leave(socket.id);
    });

    socket.emit('hello', { ...hello, serverTime: Date.now(), user: publicUser(user) });
    const active = rooms.roomOfUser(user.id);
    if (active) join(active);
  });

  return {
    io,
    emit: (socketId, event, payload) => io.sockets.sockets.get(socketId)?.emit(event, payload),
    disconnectUser(userId) {
      for (const socket of io.sockets.sockets.values()) if (socket.data.user?.id === userId) socket.disconnect(true);
    },
    close: () => new Promise((resolve) => io.close(resolve)),
  };
}
