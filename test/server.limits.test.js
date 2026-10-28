import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpClient, TestSocket, startTestServer } from '../testkit/server.js';

test('one account cannot open unlimited sockets, and closing one frees a slot', async (t) => {
  const srv = await startTestServer({ limits: { socketsPerUser: 2 } });
  t.after(() => srv.close());
  const http = new HttpClient(srv.baseUrl);
  await http.guest();
  const a = await new TestSocket(srv.baseUrl, http.cookie).ready();
  const b = await new TestSocket(srv.baseUrl, http.cookie).ready();
  await assert.rejects(() => new TestSocket(srv.baseUrl, http.cookie).ready(), /too_many_connections/);

  const other = new HttpClient(srv.baseUrl);
  await other.guest();
  await new TestSocket(srv.baseUrl, other.cookie).ready();

  a.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const c = await new TestSocket(srv.baseUrl, http.cookie).ready();
  assert.ok(c.hello);
  b.close();
  c.close();
});
