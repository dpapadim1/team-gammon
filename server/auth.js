import { randomBytes, randomInt } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { hashPassword, verifyPassword } from './passwords.js';
import { fail } from './errors.js';
import * as V from './validate.js';

export const HTTP_STATUS = Object.freeze({
  bad_username: 400,
  bad_password: 400,
  bad_request: 400,
  invalid_credentials: 401,
  auth_required: 401,
  forbidden: 403,
  guests_have_no_history: 403,
  bad_origin: 403,
  not_found: 404,
  username_taken: 409,
  rate_limited: 429,
});

export const SESSION_COOKIE = 'tg.sid';

export function publicUser(u) {
  return { id: u.id, username: u.name, guest: u.guest };
}

// What the owner sees about their own account: registered players also get their current rating.
function accountView(store, u) {
  const user = publicUser(u);
  const row = u.guest ? null : store.ratingOf(u.uid);
  return row ? { ...user, rating: Math.round(row.rating) } : user;
}

export function requireAuth(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'auth_required' });
  return next();
}

export function limiter(windowMs, limit) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: 'rate_limited' }),
  });
}

const promisify = (fn) => new Promise((resolve, reject) => fn((err) => (err ? reject(err) : resolve())));

export function registerAuthRoutes(app, { config, store, hooks }) {
  const authLimit = limiter(15 * 60 * 1000, config.rate.authPer15Min);
  const registerLimit = limiter(60 * 60 * 1000, config.rate.registerPerHour);
  const guestLimit = limiter(60 * 60 * 1000, config.rate.guestPerHour);

  // Verified against for unknown names so the response time does not reveal which usernames exist.
  let dummyHash = null;
  const getDummyHash = () => (dummyHash ??= hashPassword('timing equaliser', config.passwordCost));

  const startSession = async (req, user) => {
    await promisify((cb) => req.session.regenerate(cb));
    req.session.user = user;
  };

  app.post('/api/register', registerLimit, async (req, res) => {
    const body = req.body ?? {};
    const username = V.username(body.username);
    const password = V.password(body.password, username);
    if (store.getUserByName(username)) fail('username_taken');
    const hash = await hashPassword(password, config.passwordCost);
    let id;
    try {
      id = store.createUser(username, hash);
    } catch (err) {
      if (String(err.code).startsWith('SQLITE_CONSTRAINT')) fail('username_taken');
      throw err;
    }
    await startSession(req, { id: `u:${id}`, uid: id, name: username, guest: false });
    res.status(201).json({ user: accountView(store, req.session.user) });
  });

  app.post('/api/login', authLimit, async (req, res) => {
    const body = req.body ?? {};
    const username = typeof body.username === 'string' && body.username.length <= 64 ? body.username : '';
    const password = typeof body.password === 'string' && body.password.length <= 128 ? body.password : '';
    const row = username ? store.getUserByName(username) : undefined;
    const ok = await verifyPassword(password, row ? row.pass_hash : await getDummyHash());
    if (!row || !ok) fail('invalid_credentials');
    await startSession(req, { id: `u:${row.id}`, uid: row.id, name: row.username, guest: false });
    res.json({ user: accountView(store, req.session.user) });
  });

  app.post('/api/guest', guestLimit, async (req, res) => {
    if (req.session.user) return res.json({ user: publicUser(req.session.user) });
    await startSession(req, { id: `g:${randomBytes(8).toString('hex')}`, uid: null, name: `Guest-${randomInt(1000, 10000)}`, guest: true });
    return res.status(201).json({ user: publicUser(req.session.user) });
  });

  app.post('/api/logout', async (req, res) => {
    const user = req.session?.user;
    if (user) {
      await promisify((cb) => req.session.destroy(cb));
      hooks.onLogout?.(user.id);
    }
    res.clearCookie(SESSION_COOKIE);
    res.status(204).end();
  });

  app.get('/api/me', requireAuth, (req, res) => res.json({ user: accountView(store, req.session.user) }));

  app.delete('/api/me', authLimit, requireAuth, async (req, res) => {
    const user = req.session.user;
    if (!user.guest) {
      const row = store.getUserById(user.uid);
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!row || !(await verifyPassword(password, row.pass_hash))) fail('invalid_credentials');
      store.deleteUser(user.uid);
    }
    await promisify((cb) => req.session.destroy(cb));
    hooks.onLogout?.(user.id);
    res.clearCookie(SESSION_COOKIE);
    res.status(204).end();
  });
}
