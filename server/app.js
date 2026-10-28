import { createServer as createHttpServer } from 'node:http';
import { randomInt } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import { buildConfig } from './config.js';
import { openStore } from './db.js';
import { SqliteSessionStore } from './sessionStore.js';
import { HTTP_STATUS, SESSION_COOKIE, limiter, registerAuthRoutes } from './auth.js';
import { registerApiRoutes } from './api.js';
import { RoomManager } from './rooms.js';
import { attachSockets } from './socket.js';
import { makeOriginCheck, originGuard } from './origin.js';
import { ProtocolError } from './errors.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function createSessionMiddleware(config, store) {
  return session({
    name: SESSION_COOKIE,
    secret: config.sessionSecret,
    store: new SqliteSessionStore(store, { ttlMs: config.sessionMaxAgeMs }),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: config.trustProxy > 0 ? true : undefined,
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, maxAge: config.sessionMaxAgeMs },
  });
}

export function createServer(overrides = {}) {
  const config = buildConfig(process.env, overrides);
  let dbFile = config.dbFile;
  if (!dbFile) {
    fs.mkdirSync(path.resolve(config.dataDir), { recursive: true });
    dbFile = path.join(path.resolve(config.dataDir), 'team-gammon.db');
  }
  const store = openStore(dbFile);
  store.abandonUnfinished();

  const originAllowed = makeOriginCheck(config);
  const sessionMiddleware = createSessionMiddleware(config, store);
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy > 0) app.set('trust proxy', config.trustProxy);

  app.use(helmet({
    // Caddy sets HSTS in production.
    hsts: false,
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:'],
        'connect-src': ["'self'", 'ws:', 'wss:'],
        'object-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'upgrade-insecure-requests': config.production ? [] : null,
      },
    },
  }));
  app.get('/ping', (req, res) => res.type('text').send('pong'));
  app.use('/engine', express.static(path.join(ROOT, 'engine')));
  // URLs mirror the repository layout (/client/js/x.js imports ../../engine/index.js) so the same imports work in Node tests.
  app.use('/client', express.static(path.join(ROOT, 'client')));
  app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'client', 'index.html')));
  app.get('/rules', (req, res) => res.sendFile(path.join(ROOT, 'client', 'rules.html')));
  for (const page of ['tutorial', 'puzzles', 'leaderboard', 'privacy', 'terms', 'cookies']) app.get(`/${page}`, (req, res) => res.sendFile(path.join(ROOT, 'client', `${page}.html`)));
  app.use(express.json({ limit: '4kb' }));
  app.use('/api', limiter(60 * 1000, config.rate.apiPerMin));
  app.use(sessionMiddleware);
  app.use(originGuard(originAllowed));

  const hooks = { onLogout: null };
  const rollDice = config.rollDice ?? (() => [randomInt(1, 7), randomInt(1, 7)]);
  let sockets = null;
  const rooms = new RoomManager({ config, store, rollDice, emit: (id, event, payload) => sockets?.emit(id, event, payload) });

  registerAuthRoutes(app, { config, store, hooks });
  registerApiRoutes(app, { store, rooms });
  app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof ProtocolError) return res.status(HTTP_STATUS[err.code] ?? 400).json({ error: err.code });
    if (err.type === 'entity.too.large' || err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_request' });
    console.error(err);
    return res.status(500).json({ error: 'internal' });
  });

  const httpServer = createHttpServer(app);
  sockets = attachSockets({ httpServer, config, rooms, sessionMiddleware, originAllowed });
  hooks.onLogout = (userId) => sockets.disconnectUser(userId);

  const maintenance = setInterval(() => {
    rooms.sweep();
    store.purgeSessions();
    store.purgeChat(Date.now() - config.chatRetentionDays * 24 * 60 * 60 * 1000);
  }, 60 * 1000);
  maintenance.unref();

  return {
    config,
    store,
    rooms,
    app,
    httpServer,
    io: sockets.io,
    listen: (port = config.port, host = config.host) => new Promise((resolve) => {
      httpServer.listen(port, host, () => resolve(httpServer.address().port));
    }),
    async close() {
      clearInterval(maintenance);
      rooms.closeAll();
      httpServer.closeAllConnections();
      await sockets.close();
      store.close();
    },
  };
}
