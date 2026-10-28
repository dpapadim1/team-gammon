import session from 'express-session';

// express-session store on the shared SQLite database.
export class SqliteSessionStore extends session.Store {
  constructor(store, { ttlMs }) {
    super();
    this.store = store;
    this.ttlMs = ttlMs;
  }

  expiryOf(sess) {
    const cookieExpiry = sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : NaN;
    return Number.isFinite(cookieExpiry) ? cookieExpiry : Date.now() + this.ttlMs;
  }

  get(sid, cb) {
    try {
      const row = this.store.getSession(sid);
      if (!row) return cb(null, null);
      if (row.expires <= Date.now()) {
        this.store.destroySession(sid);
        return cb(null, null);
      }
      return cb(null, JSON.parse(row.data));
    } catch (err) {
      return cb(err);
    }
  }

  set(sid, sess, cb) {
    try {
      this.store.setSession(sid, this.expiryOf(sess), JSON.stringify(sess));
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }

  touch(sid, sess, cb) {
    try {
      this.store.touchSession(sid, this.expiryOf(sess));
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }

  destroy(sid, cb) {
    try {
      this.store.destroySession(sid);
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }
}
