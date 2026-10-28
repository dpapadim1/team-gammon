import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpClient, startTestServer, TestSocket } from '../testkit/server.js';

async function withServer(t, overrides) {
  const srv = await startTestServer(overrides);
  t.after(() => srv.close());
  return srv;
}

test('ping answers without a session and responses carry security headers', async (t) => {
  const { baseUrl } = await withServer(t);
  const client = new HttpClient(baseUrl);
  const res = await client.get('/ping');
  assert.equal(res.status, 200);
  assert.equal(res.text, 'pong');
  assert.deepEqual(res.setCookies, [], 'health checks do not create sessions');
  assert.equal(res.headers.get('x-powered-by'), null);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('the shared engine is served to browsers as ES modules', async (t) => {
  const { baseUrl } = await withServer(t);
  const res = await new HttpClient(baseUrl).get('/engine/index.js');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
  assert.match(res.text, /export/);
  assert.equal((await new HttpClient(baseUrl).get('/testkit/helpers.js')).status, 404, 'only the engine is exposed');
});

test('register, read the profile, log out and in again', async (t) => {
  const { baseUrl } = await withServer(t);
  const client = new HttpClient(baseUrl);
  const reg = await client.post('/api/register', { username: 'Alice', password: 'correct horse battery' });
  assert.equal(reg.status, 201);
  assert.deepEqual(reg.json.user, { id: 'u:1', username: 'Alice', guest: false, rating: 1200 });
  const cookie = reg.setCookies.find((c) => c.startsWith('tg.sid='));
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.doesNotMatch(cookie, /Secure/i, 'plain http in development');

  assert.deepEqual((await client.get('/api/me')).json.user, reg.json.user);
  assert.equal((await client.post('/api/logout')).status, 204);
  assert.equal((await client.get('/api/me')).status, 401);

  const login = await client.post('/api/login', { username: 'alice', password: 'correct horse battery' });
  assert.equal(login.status, 200);
  assert.equal(login.json.user.username, 'Alice', 'the stored spelling is returned');
  assert.equal((await client.get('/api/me')).status, 200);
});

test('logging in issues a fresh session id and kills the old one (no session fixation)', async (t) => {
  const { baseUrl } = await withServer(t);
  await new HttpClient(baseUrl).register('victim_1');
  const browser = new HttpClient(baseUrl);
  await browser.guest();
  const planted = browser.jar.get('tg.sid');
  assert.ok(planted);

  const login = await browser.post('/api/login', { username: 'victim_1', password: 'correct horse battery' });
  assert.equal(login.status, 200);
  assert.notEqual(browser.jar.get('tg.sid'), planted, 'a new session id is issued on login');

  const attacker = new HttpClient(baseUrl);
  attacker.jar.set('tg.sid', planted);
  assert.equal((await attacker.get('/api/me')).status, 401, 'the pre-login session id is worthless');
});

test('registration rejects bad names and passwords and duplicate names', async (t) => {
  const { baseUrl } = await withServer(t);
  const client = new HttpClient(baseUrl);
  const bad = async (body, status, error) => {
    const res = await new HttpClient(baseUrl).post('/api/register', body);
    assert.equal(res.status, status, JSON.stringify(body));
    assert.equal(res.json.error, error);
  };
  await bad({ username: 'ab', password: 'correct horse battery' }, 400, 'bad_username');
  await bad({ username: 'guest_1', password: 'correct horse battery' }, 400, 'bad_username');
  await bad({ username: 'alice', password: 'short' }, 400, 'bad_password');
  await bad({ username: 'alice', password: 'ALICE' }, 400, 'bad_password');
  await bad({ username: 5, password: 'correct horse battery' }, 400, 'bad_username');
  await bad({}, 400, 'bad_username');
  assert.equal((await client.post('/api/register', { username: 'Alice', password: 'correct horse battery' })).status, 201);
  await bad({ username: 'ALICE', password: 'another password' }, 409, 'username_taken');
});

test('login fails the same way for unknown users and wrong passwords', async (t) => {
  const { baseUrl } = await withServer(t);
  await new HttpClient(baseUrl).register('bob_1');
  const a = await new HttpClient(baseUrl).post('/api/login', { username: 'bob_1', password: 'wrong password!' });
  const b = await new HttpClient(baseUrl).post('/api/login', { username: 'nobody', password: 'wrong password!' });
  const c = await new HttpClient(baseUrl).post('/api/login', { username: ['x'], password: 5 });
  for (const r of [a, b, c]) {
    assert.equal(r.status, 401);
    assert.deepEqual(r.json, { error: 'invalid_credentials' });
  }
});

test('guests get a session without a password and cannot read history', async (t) => {
  const { baseUrl } = await withServer(t);
  const client = new HttpClient(baseUrl);
  assert.equal((await client.get('/api/rooms')).status, 401);
  const first = await client.post('/api/guest');
  assert.equal(first.status, 201);
  assert.match(first.json.user.id, /^g:[0-9a-f]{16}$/);
  assert.match(first.json.user.username, /^Guest-\d{4}$/);
  assert.equal(first.json.user.guest, true);
  const again = await client.post('/api/guest');
  assert.equal(again.status, 200);
  assert.deepEqual(again.json.user, first.json.user, 'asking again returns the same guest');
  assert.deepEqual((await client.get('/api/rooms')).json, { rooms: [] });
  assert.equal((await client.get('/api/games')).status, 403);
  assert.equal((await client.get('/api/games/1')).status, 403);
});

test('cross-site state-changing requests are refused', async (t) => {
  const { baseUrl, port } = await withServer(t);
  const client = new HttpClient(baseUrl);
  const evil = await client.post('/api/guest', {}, { origin: 'https://evil.example' });
  assert.equal(evil.status, 403);
  assert.deepEqual(evil.json, { error: 'bad_origin' });
  const same = await client.post('/api/guest', {}, { origin: `http://127.0.0.1:${port}` });
  assert.equal(same.status, 201);
  assert.equal((await client.get('/api/me', { origin: 'https://evil.example' })).status, 200, 'reads are not state changing');
});

test('allow-listed origins may call the API', async (t) => {
  const { baseUrl } = await withServer(t, { allowedOrigins: ['https://app.example'] });
  const res = await new HttpClient(baseUrl).post('/api/guest', {}, { origin: 'https://app.example' });
  assert.equal(res.status, 201);
});

test('malformed and oversized bodies are rejected cleanly', async (t) => {
  const { baseUrl } = await withServer(t);
  const client = new HttpClient(baseUrl);
  const broken = await client.request('POST', '/api/login', '{"username": ', { 'content-type': 'application/json' });
  assert.equal(broken.status, 400);
  assert.deepEqual(broken.json, { error: 'bad_request' });
  const big = await client.post('/api/login', { username: 'a', password: 'x'.repeat(10000) });
  assert.equal(big.status, 400);
  const notJson = await client.request('POST', '/api/login', 'username=a&password=b', { 'content-type': 'text/plain' });
  assert.equal(notJson.status, 401, 'a non-JSON body is just empty credentials');
  assert.deepEqual((await client.get('/api/nope')).json, { error: 'not_found' });
});

test('authentication endpoints are rate limited', async (t) => {
  const { baseUrl } = await withServer(t, { rate: { authPer15Min: 3, registerPerHour: 1000, guestPerHour: 1000, apiPerMin: 100000 } });
  const client = new HttpClient(baseUrl);
  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push((await client.post('/api/login', { username: 'x', password: 'wrong password!' })).status);
  assert.deepEqual(statuses, [401, 401, 401, 429, 429]);
  const limited = await client.post('/api/login', { username: 'x', password: 'wrong password!' });
  assert.deepEqual(limited.json, { error: 'rate_limited' });
});

test('deleting an account needs the password and removes the user', async (t) => {
  const { baseUrl, server } = await withServer(t);
  const client = new HttpClient(baseUrl);
  await client.register('carol');
  assert.equal((await client.delete('/api/me', { password: 'wrong password!' })).status, 401);
  assert.equal((await client.get('/api/me')).status, 200, 'still signed in after a failed attempt');
  assert.equal((await client.delete('/api/me', { password: 'correct horse battery' })).status, 204);
  assert.equal((await client.get('/api/me')).status, 401);
  assert.equal(server.store.getUserByName('carol'), undefined);
  assert.equal((await new HttpClient(baseUrl).post('/api/login', { username: 'carol', password: 'correct horse battery' })).status, 401);

  const guest = new HttpClient(baseUrl);
  await guest.guest();
  assert.equal((await guest.delete('/api/me', {})).status, 204, 'guests just end the session');
});

test('sessions are stored in the database and survive a store lookup', async (t) => {
  const { baseUrl, server } = await withServer(t);
  const client = new HttpClient(baseUrl);
  await client.register('dave_1');
  const sid = decodeURIComponent(client.jar.get('tg.sid')).slice(2).split('.')[0];
  const row = server.store.getSession(sid);
  assert.ok(row);
  assert.equal(JSON.parse(row.data).user.name, 'dave_1');
  assert.ok(row.expires > Date.now());
  await client.post('/api/logout');
  assert.equal(server.store.getSession(sid), undefined, 'logout destroys the stored session');
});

test('behind a TLS proxy the session cookie is Secure and sockets still authenticate', async (t) => {
  const { baseUrl } = await withServer(t, { production: true, secureCookies: true, trustProxy: 1, sessionSecret: 'p'.repeat(40) });
  const client = new HttpClient(baseUrl);
  const tls = { 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.9' };
  const res = await client.post('/api/guest', {}, tls);
  assert.equal(res.status, 201);
  assert.match(res.setCookies.find((c) => c.startsWith('tg.sid=')), /Secure/i);
  assert.match(res.headers.get('content-security-policy'), /upgrade-insecure-requests/);
  assert.equal((await client.get('/api/me', tls)).status, 200);

  const ws = await new TestSocket(baseUrl, client.cookie, { extraHeaders: { cookie: client.cookie, ...tls } }).ready();
  assert.equal(ws.hello.user.guest, true);
  ws.close();
});

test('sockets refuse connections without a session or from a foreign origin', async (t) => {
  const { baseUrl } = await withServer(t);
  await assert.rejects(() => new TestSocket(baseUrl, '').ready(), /auth_required/);

  const client = new HttpClient(baseUrl);
  await client.guest();
  const ok = await new TestSocket(baseUrl, client.cookie).ready();
  assert.equal(ok.hello.protocol, 1);
  ok.close();
  await assert.rejects(
    () => new TestSocket(baseUrl, client.cookie, { extraHeaders: { cookie: client.cookie, origin: 'https://evil.example' } }).ready(),
    /./,
  );
});
