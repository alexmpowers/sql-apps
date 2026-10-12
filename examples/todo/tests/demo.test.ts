import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createDemoApplication } from '../../../src/demo-app.js';
import { application } from '../application.js';

test('public demo has opaque secure sessions and forwards only hashes to fixed internal procedures', async t => {
  const calls: { name: string; body: Record<string, unknown> }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'http://127.0.0.1:5000');
    assert.equal(init?.method, 'POST');
    const body = JSON.parse(String(init?.body));
    calls.push({ name: url.pathname.slice('/api/'.length), body });
    if (url.pathname.endsWith('/Readiness')) return Response.json({ value: [{ status: 'ready', schema_version: 1 }] });
    if (url.pathname.endsWith('/List')) return Response.json({ value: [{ outcome: 'ok', id: null, title: null, completed: null }] });
    return Response.json({ value: [{ outcome: 'ok', expires_at: new Date(Date.now() + 3_600_000).toISOString() }] });
  };
  const app = await createDemoApplication(application, {
    profile: 'public-demo', origin: 'https://demo.example.com', dabUrl: 'http://127.0.0.1:5000',
  }, fetcher);
  t.after(() => app.close());
  const headers = { host: 'demo.example.com', origin: 'https://demo.example.com' };
  assert.equal((await app.inject({ method: 'POST', url: '/api/session', headers, payload: {} })).statusCode, 400);
  assert.equal(calls.length, 0);
  const created = await app.inject({ method: 'POST', url: '/api/session', headers, payload: { synthetic: true } });
  assert.equal(created.statusCode, 201);
  const setCookie = String(created.headers['set-cookie']);
  assert.match(setCookie, /__Host-sql_apps_session=/);
  assert.match(setCookie, /; HttpOnly/);
  assert.match(setCookie, /; Secure/);
  assert.match(setCookie, /; SameSite=Strict/);
  assert.match(setCookie, /; Max-Age=3600/);
  assert.doesNotMatch(setCookie, /Domain=/);
  const cookie = setCookie.split(';')[0]!;
  const token = cookie.slice(cookie.indexOf('=') + 1);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const hash = createHash('sha256').update(token).digest('hex');
  assert.deepEqual(calls[0], { name: 'CreateSession', body: { token_hash: hash } });
  assert.deepEqual((await app.inject({ url: '/api/todos', headers: { ...headers, cookie } })).json(), { items: [] });
  assert.deepEqual(calls.at(-1), { name: 'List', body: { token_hash: hash } });
  assert.equal((await app.inject({ url: '/api/todos', headers })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/session', headers: { ...headers, cookie } })).statusCode, 200);
  assert.equal((await app.inject({ url: '/health/ready', headers: { host: 'localhost:8080' } })).statusCode, 200);
  assert.equal((await app.inject({ url: '/api/health/ready', headers: { host: 'localhost:8080' } })).statusCode, 200);
  assert.deepEqual(calls.at(-1), { name: 'Readiness', body: {} });
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/session', headers: { ...headers, cookie } })).statusCode, 204);
  assert.deepEqual(calls.at(-1), { name: 'DeleteSession', body: { token_hash: hash } });
  for (const path of ['/api/List', '/graphql', '/local/session', '/functions/echo']) {
    assert.equal((await app.inject({ url: path, headers })).statusCode, 404);
  }
});

test('deployed adapter cannot relax TLS, internal DAB or origin checks', async t => {
  const options = { profile: 'public-demo' as const, origin: 'https://demo.example.com', dabUrl: 'http://127.0.0.1:5000' };
  for (const changed of [
    { origin: 'http://demo.example.com' }, { origin: 'https://demo.example.com/path' },
    { dabUrl: 'https://external.example.com' }, { dabUrl: 'http://127.0.0.1:5000/path' },
  ]) {
    await assert.rejects(createDemoApplication(application, { ...options, ...changed }), /origin|internal|loopback/);
  }
  let calls = 0;
  const app = await createDemoApplication(application, options, async () => { calls++; throw new Error('Should not reach DAB'); });
  t.after(() => app.close());
  for (const headers of [
    { host: 'demo.example.com' },
    { host: 'demo.example.com', origin: 'https://wrong.example.com' },
    { host: 'wrong.example.com', origin: 'https://demo.example.com' },
    { host: 'demo.example.com', origin: 'https://demo.example.com', 'x-ms-client-principal': 'forged' },
  ]) {
    assert.equal((await app.inject({ method: 'POST', url: '/api/session', headers, payload: { synthetic: true } })).statusCode, 403);
  }
  assert.equal(calls, 0);

  const linked = await createDemoApplication(application, { ...options, transport: 'static-web-apps' },
    async () => { throw new Error('Should not reach DAB'); });
  t.after(() => linked.close());
  assert.equal((await linked.inject({
    method: 'POST', url: '/api/session',
    headers: { host: 'internal.azurecontainerapps.io', origin: options.origin },
    payload: {},
  })).statusCode, 400, 'SWA-linked requests may use the backend host after platform authentication');
  assert.equal((await linked.inject({
    method: 'POST', url: '/api/session',
    headers: { host: 'internal.azurecontainerapps.io', origin: options.origin, 'x-ms-api-role': 'anonymous' },
    payload: { synthetic: true },
  })).statusCode, 403);
});

test('loopback test transport uses origin-scoped cookie names and does not change the route contract', async t => {
  const manifests = [];
  const names = [];
  for (const origin of ['http://127.0.0.1:44010', 'http://127.0.0.1:44850']) {
    const app = await createDemoApplication(application, {
      profile: 'local-simulation', origin, dabUrl: 'http://127.0.0.1:5000',
    }, async () => Response.json({ value: [{ outcome: 'ok', expires_at: new Date(Date.now() + 3_600_000).toISOString() }] }));
    t.after(() => app.close());
    const headers = { host: new URL(origin).host, origin };
    const created = await app.inject({ method: 'POST', url: '/api/session', headers, payload: { synthetic: true } });
    assert.equal(created.statusCode, 201);
    const cookie = String(created.headers['set-cookie']);
    assert.doesNotMatch(cookie, /; Secure/);
    assert.match(cookie, new RegExp(`^sql_apps_session_${createHash('sha256').update(origin).digest('hex').slice(0, 12)}=`));
    assert.match(cookie, /; Path=\/; Max-Age=3600; HttpOnly; SameSite=Strict$/);
    names.push(cookie.split('=')[0]);
    manifests.push((await app.inject({ url: '/application/manifest', headers })).json());
  }
  assert.notEqual(names[0], names[1]);
  assert.deepEqual(manifests[0], manifests[1]);
});

test('expired sessions fail closed and SQL errors cannot become empty successful lists', async t => {
  let mode = 'expired';
  const app = await createDemoApplication(application, {
    profile: 'public-demo', origin: 'https://demo.example.com', dabUrl: 'http://127.0.0.1:5000',
  }, async () => {
    if (mode === 'http') return new Response(null, { status: 500 });
    if (mode === 'invalid') return Response.json({ value: [] });
    return Response.json({ value: [{ outcome: 'expired', expires_at: null }] });
  });
  t.after(() => app.close());
  const headers = { host: 'demo.example.com', cookie: `__Host-sql_apps_session=${'a'.repeat(43)}` };
  assert.equal((await app.inject({ url: '/api/todos', headers })).statusCode, 401);
  mode = 'http';
  assert.equal((await app.inject({ url: '/api/todos', headers })).statusCode, 503);
  mode = 'invalid';
  assert.equal((await app.inject({ url: '/api/todos', headers })).statusCode, 502);
  assert.equal((await app.inject({ url: '/api/todos', headers: { ...headers, cookie: '__Host-sql_apps_session=invalid' } })).statusCode, 400);
  assert.equal((await app.inject({ url: '/api/todos', headers: { ...headers, cookie: `${headers.cookie}; ${headers.cookie}` } })).statusCode, 400);
});

test('public demo returns too many requests when the global session limit is reached', async t => {
  const app = await createDemoApplication(application, {
    profile: 'public-demo', origin: 'https://demo.example.com', dabUrl: 'http://127.0.0.1:5000',
  }, async () => Response.json({ value: [{ outcome: 'capacity', expires_at: null }] }));
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST', url: '/api/session',
    headers: { host: 'demo.example.com', origin: 'https://demo.example.com' },
    payload: { synthetic: true },
  });
  assert.equal(response.statusCode, 429);
});
