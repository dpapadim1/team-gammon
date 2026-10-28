import { fail } from './errors.js';
import { requireAuth } from './auth.js';

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function registerApiRoutes(app, { store, rooms }) {
  app.get('/api/rooms', requireAuth, (req, res) => res.json({ rooms: rooms.listPublic() }));

  // Public: registered players by rating, plus the caller's own standing when signed in.
  app.get('/api/leaderboard', (req, res) => {
    const body = { players: store.leaderboard({ limit: clampInt(req.query.limit, 1, 100, 50) }) };
    const user = req.session?.user;
    const me = user && !user.guest ? store.standingOf(user.uid) : null;
    if (me) body.me = me;
    res.json(body);
  });

  app.get('/api/games', requireAuth, (req, res) => {
    const user = req.session.user;
    if (user.guest) fail('guests_have_no_history');
    const limit = clampInt(req.query.limit, 1, 100, 20);
    const before = clampInt(req.query.before, 1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    res.json({ games: store.gamesOfUser(user.uid, { limit, before }) });
  });

  app.get('/api/games/:id', requireAuth, (req, res) => {
    const user = req.session.user;
    if (user.guest) fail('forbidden');
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) fail('not_found');
    const game = store.getGame(id);
    if (!game || game.endedAt === null) fail('not_found');
    if (store.seatOfPlayer(id, user.uid) === null) fail('forbidden');
    res.json({ game });
  });
}
