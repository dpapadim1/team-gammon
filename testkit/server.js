import { io as connect } from 'socket.io-client';
import { Position, VARIANTS, compileVariant, createRng, enumerateTurns } from '../engine/index.js';
import { createServer } from '../server/app.js';

// Fast, deterministic server for tests: in-memory database, cheap password hashing, no artificial delays.
export async function startTestServer(overrides = {}) {
  const dice = createRng(overrides.seed ?? 1);
  const server = createServer({
    dbFile: ':memory:',
    passwordCost: { N: 1024, r: 8, p: 1 },
    timing: { startDelayMs: 0, rollDelayMs: 0, passDelayMs: 0, botThinkMs: 0 },
    rollDice: () => dice.roll(),
    rate: { authPer15Min: 1000, registerPerHour: 1000, guestPerHour: 1000, apiPerMin: 100000 },
    ...overrides,
  });
  const port = await server.listen(0, '127.0.0.1');
  return { server, port, baseUrl: `http://127.0.0.1:${port}`, close: () => server.close() };
}

export class HttpClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.jar = new Map();
  }

  get cookie() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async request(method, path, body, headers = {}) {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const setCookies = res.headers.getSetCookie();
    for (const c of setCookies) {
      const pair = c.split(';')[0];
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (value === '') this.jar.delete(name);
      else this.jar.set(name, value);
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json, text, headers: res.headers, setCookies };
  }

  get(path, headers) {
    return this.request('GET', path, undefined, headers);
  }

  post(path, body = {}, headers) {
    return this.request('POST', path, body, headers);
  }

  delete(path, body, headers) {
    return this.request('DELETE', path, body, headers);
  }

  async guest() {
    const res = await this.post('/api/guest');
    if (res.status >= 300) throw new Error(`guest failed: ${res.text}`);
    return res.json.user;
  }

  async register(username, password = 'correct horse battery') {
    const res = await this.post('/api/register', { username, password });
    if (res.status !== 201) throw new Error(`register failed: ${res.text}`);
    return res.json.user;
  }
}

export class TestSocket {
  constructor(baseUrl, cookie, options = {}) {
    this.state = null;
    this.hello = null;
    this.chat = [];
    this.history = null;
    this.waiters = [];
    this.socket = connect(baseUrl, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      extraHeaders: cookie ? { cookie } : {},
      ...options,
    });
    this.socket.on('state', (s) => {
      if (this.state && s.version <= this.state.version) return;
      this.state = s;
      for (const w of [...this.waiters]) w.check(s);
    });
    this.socket.on('hello', (h) => {
      this.hello = h;
    });
    this.socket.on('chat', (m) => this.chat.push(m));
    this.socket.on('chat:history', (h) => {
      this.history = h.messages;
    });
  }

  // Resolves once connected (and greeted); rejects with the server's connect_error message.
  ready() {
    return new Promise((resolve, reject) => {
      this.socket.once('connect_error', (err) => reject(new Error(err.message)));
      this.socket.once('hello', () => resolve(this));
    });
  }

  emit(event, payload) {
    return new Promise((resolve) => this.socket.emit(event, payload, resolve));
  }

  waitState(predicate, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      if (this.state && predicate(this.state)) return resolve(this.state);
      const waiter = {
        check: (s) => {
          if (!predicate(s)) return;
          clearTimeout(timer);
          this.waiters = this.waiters.filter((w) => w !== waiter);
          resolve(s);
        },
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        const s = this.state;
        reject(new Error(`timed out waiting for a state; last: ${s ? JSON.stringify({ v: s.version, phase: s.phase, game: s.game && { actor: s.game.actor, dice: s.game.dice, result: s.game.result, turn: s.game.turnNumber } }) : 'none'}`));
      }, timeoutMs);
      this.waiters.push(waiter);
      return undefined;
    });
  }

  close() {
    this.socket.close();
  }
}

export async function connectSocket(baseUrl, client) {
  return new TestSocket(baseUrl, client.cookie).ready();
}

// Picks a random legal turn for the seat on turn from a `state` snapshot, as a client would using the shared engine.
export function chooseTurnFromState(state, rng) {
  const variant = VARIANTS[state.game.variant];
  const rules = compileVariant(variant);
  const position = Position.fromText(rules, state.game.position);
  const turns = enumerateTurns(position, rules.seatIndex.get(state.game.actor), state.game.dice);
  return turns[rng.int(turns.length)].steps.map((s) => [s.from, s.die]);
}

// Makes the socket play every turn of `seat` with random legal turns until the game is over.
export function autoPlay(testSocket, seat, seed = 7) {
  const rng = createRng(seed);
  const played = new Set();
  const onState = (s) => {
    const g = s.game;
    if (s.phase !== 'playing' || !g || g.result || !g.dice || g.actor !== seat) return;
    const key = `${g.gameId}:${g.turnNumber}`;
    if (played.has(key)) return;
    played.add(key);
    testSocket.emit('turn:play', { steps: chooseTurnFromState(s, rng) });
  };
  testSocket.socket.on('state', onState);
  if (testSocket.state) onState(testSocket.state);
}
