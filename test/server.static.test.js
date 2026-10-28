import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpClient, startTestServer } from '../testkit/server.js';
import { SESSION_COOKIE } from '../server/auth.js';
import { MIN_RATED_TURNS, PROVISIONAL_GAMES, START_RATING } from '../server/ratings.js';

// The keys the client code reads and writes in the browser's local storage.
function storageKeys() {
  const keys = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else if (entry.name.endsWith('.js')) for (const m of fs.readFileSync(join(dir, entry.name), 'utf8').matchAll(/['"`](tg\.[a-z]+)['"`]/g)) keys.add(m[1]);
    }
  };
  walk(fileURLToPath(new URL('../client/js/', import.meta.url)));
  return keys;
}

// Everything a page needs has to be served: walk the module graph the way a browser would.
async function moduleGraph(client, entry) {
  const seen = new Map();
  const queue = [entry];
  while (queue.length) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    const res = await client.get(path);
    seen.set(path, res);
    if (res.status !== 200) continue;
    const specs = [...res.text.matchAll(/(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const spec of specs) {
      if (!spec.startsWith('.')) {
        seen.set(`${path} -> ${spec}`, { status: 'not relative', text: '' });
        continue;
      }
      queue.push(new URL(spec, `http://host${path}`).pathname);
    }
  }
  return seen;
}

function rawGet(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

test('the pages and their modules are served with a strict content security policy', async () => {
  const srv = await startTestServer();
  try {
    const client = new HttpClient(srv.baseUrl);
    for (const path of ['/', '/rules', '/privacy', '/terms', '/cookies', '/leaderboard', '/tutorial', '/puzzles']) {
      const res = await client.get(path);
      assert.equal(res.status, 200, path);
      assert.match(res.headers.get('content-type'), /text\/html/);
      assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
      assert.equal(/<script(?![^>]*\bsrc=)/i.test(res.text), false, `${path} has no inline script`);
      assert.equal(/\son[a-z]+\s*=/i.test(res.text), false, `${path} has no inline event handler`);
    }
    const index = (await client.get('/')).text;
    assert.match(index, /<main id="app"/);
    assert.match(index, /\/socket\.io\/socket\.io\.js/);

    const js = await client.get('/client/js/main.js');
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type'), /javascript/);
    assert.equal((await client.get('/client/css/app.css')).status, 200);
    assert.equal((await client.get('/client/favicon.svg')).status, 200);
    const puzzles = await client.get('/client/puzzles.json');
    assert.equal(puzzles.status, 200);
    assert.match(puzzles.headers.get('content-type'), /json/);
    assert.ok(Array.isArray(JSON.parse(puzzles.text).puzzles), 'the puzzles are served as data');
    assert.equal((await client.get('/socket.io/socket.io.js')).status, 200);
  } finally {
    await srv.close();
  }
});

test('the policies quote the real cookie name and retention periods and link to each other', async () => {
  const srv = await startTestServer();
  try {
    const client = new HttpClient(srv.baseUrl);
    const { sessionMaxAgeMs, chatRetentionDays } = srv.server.config;
    const cookies = (await client.get('/cookies')).text;
    const privacy = (await client.get('/privacy')).text;
    assert.ok(cookies.includes(SESSION_COOKIE), 'the cookie policy names the session cookie');
    assert.ok(cookies.includes(`${Math.round(sessionMaxAgeMs / 86400000)} days`), 'and its lifetime');
    assert.ok(privacy.includes(`${chatRetentionDays} days`), 'the privacy policy states the chat retention');
    assert.ok(privacy.includes('href="/leaderboard"'), 'and that ratings are public');
    const board = (await client.get('/leaderboard')).text;
    for (const number of [START_RATING, PROVISIONAL_GAMES, MIN_RATED_TURNS]) assert.ok(board.includes(String(number)), `the leaderboard page explains ${number}`);
    for (const path of ['/', '/rules', '/privacy', '/terms', '/cookies', '/leaderboard', '/tutorial', '/puzzles']) {
      const page = (await client.get(path)).text;
      for (const target of ['/tutorial', '/puzzles', '/leaderboard', '/privacy', '/terms', '/cookies']) assert.ok(page.includes(`href="${target}"`), `${path} links to ${target}`);
    }
    const keys = storageKeys();
    assert.ok(keys.has('tg.prefs') && keys.has('tg.puzzles'), 'the scan finds the keys the client uses');
    for (const key of keys) assert.ok(cookies.includes(`<code>${key}</code>`), `the cookie policy names ${key}`);
  } finally {
    await srv.close();
  }
});

test('every module the pages import is served, and none needs Node or a bundler', async () => {
  const srv = await startTestServer();
  try {
    const client = new HttpClient(srv.baseUrl);
    for (const entry of ['/client/js/main.js', '/client/js/rulesPage.js', '/client/js/leaderboardPage.js', '/client/js/tutorialPage.js', '/client/js/puzzlesPage.js']) {
      const graph = await moduleGraph(client, entry);
      assert.ok(graph.size > 10, `${entry} pulls in its modules`);
      for (const [path, res] of graph) assert.equal(res.status, 200, `${path} must be served as a relative module`);
    }
  } finally {
    await srv.close();
  }
});

test('server code, data and parent folders are not exposed', async () => {
  const srv = await startTestServer();
  try {
    const client = new HttpClient(srv.baseUrl);
    for (const path of ['/server/app.js', '/test/client.test.js', '/package.json', '/.git/config', '/node_modules/express/package.json', '/data/team-gammon.db', '/bots/levels.js']) {
      assert.equal((await client.get(path)).status, 404, path);
    }
    for (const path of ['/client/%2e%2e/server/app.js', '/client/..%2fserver/app.js', '/engine/%2e%2e/package.json', '/client/%2e%2e%2fpackage.json']) {
      const status = await rawGet(srv.port, path);
      assert.ok(status === 403 || status === 404 || status === 400, `${path} -> ${status}`);
    }
  } finally {
    await srv.close();
  }
});
