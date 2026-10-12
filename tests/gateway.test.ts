import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGateway, type GatewayDependencies } from '../src/gateway.js';
import { objectKey, type StoredFile } from '../src/storage.js';
import type { RuntimeConfig } from '../src/config.js';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { DependencyReadinessError } from '../src/readiness.js';

const config: RuntimeConfig = {
  tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  apiClientId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  dabUrl: 'https://data.internal', blobAccountUrl: 'https://store.blob.core.windows.net',
  blobContainer: 'files', functionsUrl: 'https://functions.internal', publicDirectory: 'public',
};
function dependencies(overrides: Partial<GatewayDependencies> = {}): GatewayDependencies {
  const objects = new Map<string, StoredFile>();
  return {
    async verifyUser(token) {
      if (!['alice', 'bob'].includes(token)) throw new Error('Invalid token');
      return { oid: token, tenantId: config.tenantId };
    },
    files: {
      async put(key, bytes) { objects.set(key, { bytes, contentType: 'application/octet-stream' }); },
      async get(key) { return objects.get(key); },
      async delete(key) { return objects.delete(key); },
    },
    fetch: async () => new Response(JSON.stringify({ value: [] }), { headers: { 'content-type': 'application/json' } }),
    functionToken: async () => 'gateway-service-token',
    ...overrides,
  };
}
test('public frontend and auth config; API rejects missing/invalid tokens', async t => {
  const app = await createGateway(config, dependencies());
  t.after(() => app.close());
  assert.equal((await app.inject('/')).statusCode, 200);
  assert.equal((await app.inject('/auth/config')).json().clientId, config.apiClientId);
  assert.equal((await app.inject('/auth/config')).json().mode, 'entra');
  assert.equal((await app.inject({ url: '/local/session', method: 'POST', payload: { user: 'alice' } })).statusCode, 404);
  for (const url of ['/api/Todo', '/storage/test', '/auth/me']) {
    assert.equal((await app.inject(url)).statusCode, 401);
    assert.equal((await app.inject({ url, headers: { authorization: 'Bearer invalid' } })).statusCode, 401);
  }
  assert.equal((await app.inject({ url: '/graphql', method: 'POST', payload: {} })).statusCode, 401);
  assert.equal((await app.inject({ url: '/functions/echo', method: 'POST', payload: {} })).statusCode, 401);
});
test('data proxy forwards bearer token but drops client-supplied identity, role and cookies', async t => {
  let target = '';
  let forwarded = new Headers();
  const app = await createGateway(config, dependencies({
    fetch: async (url, options) => {
      target = String(url);
      forwarded = new Headers(options?.headers);
      return new Response('{"value":[]}', { headers: { 'content-type': 'application/json' } });
    },
  }));
  t.after(() => app.close());
  const result = await app.inject({
    url: '/api/Todo?$first=10',
    headers: { authorization: 'Bearer alice', 'x-ms-client-principal': 'spoofed', 'x-ms-api-role': 'admin', cookie: 'secret=true' },
  });
  assert.equal(result.statusCode, 200);
  assert.equal(target, 'https://data.internal/api/Todo?$first=10');
  assert.equal(forwarded.get('authorization'), 'Bearer alice');
  assert.equal(forwarded.get('x-ms-client-principal'), null);
  assert.equal(forwarded.get('x-ms-api-role'), null);
  assert.equal(forwarded.get('cookie'), null);
  assert.equal(result.headers['cache-control'], 'no-store');
});
test('data proxy forwards only the supported update-only If-Match value', async t => {
  const received: (string | null)[] = [];
  const app = await createGateway(config, dependencies({
    fetch: async (_url, options) => {
      received.push(new Headers(options?.headers).get('if-match'));
      return new Response(null, { status: 204 });
    },
  }));
  t.after(() => app.close());
  for (const value of ['*', '"untrusted-etag"']) {
    const result = await app.inject({ method: 'PATCH', url: '/api/Todo/id/example',
      headers: { authorization: 'Bearer alice', 'if-match': value }, payload: { completed: true } });
    assert.equal(result.statusCode, 204);
  }
  assert.deepEqual(received, ['*', null]);
});

test('data and function proxies stream upstream bodies without buffering them', async t => {
  const app = await createGateway(config, dependencies({
    fetch: async () => {
      const response = new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"streamed":true}'));
          controller.close();
        },
      }), { headers: { 'content-type': 'application/json' } });
      Object.defineProperty(response, 'arrayBuffer', {
        value: async () => { throw new Error('response was buffered'); },
      });
      return response;
    },
  }));
  t.after(() => app.close());
  const headers = { authorization: ['Bearer', 'alice'].join(' ') };
  const data = await app.inject({ url: '/api/Todo', headers });
  assert.equal(data.statusCode, 200);
  assert.deepEqual(data.json(), { streamed: true });
  const invoked = await app.inject({ method: 'POST', url: '/functions/echo', headers, payload: {} });
  assert.equal(invoked.statusCode, 200);
  assert.deepEqual(invoked.json(), { streamed: true });
});

for (const { method, path } of [{ method: 'GET', path: '/api/stream' }, { method: 'POST', path: '/functions/echo' }]) {
  test(`${path} cancels upstream when the client disconnects during a pending read`, { timeout: 5_000 }, async t => {
    let cancelled!: () => void;
    const upstreamClosed = new Promise<void>(resolve => { cancelled = resolve; });
    const upstream = createServer((request, response) => {
      request.resume();
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('{"streamed":');
      response.once('close', cancelled);
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const address = upstream.address();
    assert.ok(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;
    const app = await createGateway({ ...config, dabUrl: origin, functionsUrl: origin }, dependencies({ fetch }));
    t.after(async () => {
      upstream.closeAllConnections();
      await app.close();
      await new Promise<void>((resolve, reject) => upstream.close(error => error ? reject(error) : resolve()));
    });
    const gateway = await app.listen({ host: '127.0.0.1', port: 0 });
    const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
      const request = httpRequest(new URL(path, gateway), {
        method, headers: { authorization: ['Bearer', 'alice'].join(' ') },
      }, resolve);
      request.once('error', reject);
      request.end();
    });
    response.on('error', (error: NodeJS.ErrnoException) => { if (error.code !== 'ECONNRESET') throw error; });
    const [chunk] = await once(response, 'data');
    assert.equal(response.statusCode, 200);
    assert.equal(chunk.toString(), '{"streamed":', 'the first chunk arrives before the upstream response ends');
    response.destroy();
    const stopped = await Promise.race([upstreamClosed.then(() => true), delay(1_000).then(() => false)]);
    assert.equal(stopped, true, 'disconnect must cancel upstream without waiting for the 30-second proxy timeout');
  });
}

test('files are scoped by verified user; overwrite/delete and missing file behavior', async t => {
  const app = await createGateway(config, dependencies());
  t.after(() => app.close());
  const alice = { authorization: 'Bearer alice', 'content-type': 'application/octet-stream' };
  assert.equal((await app.inject({ method: 'PUT', url: '/storage/note.txt', headers: alice, payload: Buffer.from('private') })).statusCode, 204);
  assert.equal((await app.inject({ url: '/storage/note.txt', headers: { authorization: 'Bearer bob' } })).statusCode, 404);
  const own = await app.inject({ url: '/storage/note.txt', headers: { authorization: 'Bearer alice' } });
  assert.equal(own.body, 'private');
  assert.equal(own.headers['content-disposition'], 'attachment');
  assert.equal((await app.inject({ method: 'DELETE', url: '/storage/note.txt', headers: { authorization: 'Bearer bob' } })).statusCode, 404);
  assert.equal((await app.inject({ method: 'PUT', url: '/storage/note.txt', headers: alice, payload: Buffer.from('updated') })).statusCode, 204);
  assert.equal((await app.inject({ method: 'DELETE', url: '/storage/note.txt', headers: { authorization: 'Bearer alice' } })).statusCode, 204);
});
test('file limits and unsafe names are rejected', async t => {
  const app = await createGateway(config, dependencies());
  t.after(() => app.close());
  assert.throws(() => objectKey('tenant', 'alice', '../other'));
  assert.throws(() => objectKey('tenant', 'alice', 'a/b'));
  const limit = 4 * 1024 * 1024;
  const upload = await app.inject({
    method: 'PUT', url: '/storage/exact-limit',
    headers: { authorization: 'Bearer alice', 'content-type': 'application/octet-stream' },
    payload: Buffer.alloc(limit, 65),
  });
  assert.equal(upload.statusCode, 204);
  const download = await app.inject({
    url: '/storage/exact-limit', headers: { authorization: 'Bearer alice' },
  });
  assert.equal(download.statusCode, 200);
  assert.equal(download.rawPayload.length, limit);
  assert.equal(download.rawPayload.equals(Buffer.alloc(limit, 65)), true);
  assert.equal((await app.inject({ method: 'PUT', url: '/storage/file', headers: { authorization: 'Bearer alice', 'content-type': 'application/octet-stream' }, payload: Buffer.alloc(4 * 1024 * 1024 + 1) })).statusCode, 413);
  assert.equal((await app.inject({ method: 'PUT', url: '/storage/file', headers: { authorization: 'Bearer alice' }, payload: { bad: 'json' } })).statusCode, 415);
});
test('function invocation substitutes service identity and carries validated user separately', async t => {
  let headers = new Headers();
  let body: unknown;
  const app = await createGateway(config, dependencies({
    fetch: async (_url, options) => {
      headers = new Headers(options?.headers);
      body = JSON.parse(String(options?.body));
      return new Response('{"result":"ok"}');
    },
  }));
  t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: '/functions/echo', headers: { authorization: 'Bearer alice' }, payload: { hello: 'Azure' } });
  assert.equal(response.statusCode, 200);
  assert.equal(headers.get('authorization'), 'Bearer gateway-service-token');
  assert.deepEqual(body, { user: { oid: 'alice', tenantId: config.tenantId }, input: { hello: 'Azure' } });
});
test('dependency errors are explicit; readiness fails closed', async t => {
  const app = await createGateway(config, dependencies({ fetch: async () => { throw new Error('dependency secret'); } }));
  t.after(() => app.close());
  assert.equal((await app.inject('/health/live')).statusCode, 200);
  assert.equal((await app.inject('/health/ready')).statusCode, 503);
  const response = await app.inject({ url: '/api/Todo', headers: { authorization: 'Bearer alice' } });
  assert.equal(response.statusCode, 500);
  assert.equal(response.body.includes('dependency secret'), false);
});

test('readiness exposes only a safe dependency identifier and never its private cause', async t => {
  const app = await createGateway(config, dependencies({
    ready: async () => { throw new DependencyReadinessError('functions', new Error('synthetic private credential')); },
  }));
  t.after(() => app.close());
  const warning = t.mock.method(app.log, 'warn');
  const response = await app.inject('/health/ready');
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { status: 'not-ready', dependency: 'functions' });
  assert.equal(response.body.includes('synthetic private credential'), false);
  assert.equal(JSON.stringify(warning.mock.calls.map(call => call.arguments)).includes('synthetic private credential'), false);
  assert.equal((await app.inject('/health/live')).statusCode, 200);
});

test('file listing and jobs use verified identity and refuse caller-managed fields', async t => {
  const id = '11111111-1111-4111-8111-111111111111';
  const deps = dependencies({
    processing: {
      async list(identity) { assert.equal(identity.oid, 'alice'); return []; },
      async create(identity, name) {
        assert.equal(identity.oid, 'alice'); assert.equal(name, 'file.txt'); return id;
      },
      async delete(identity, value) { assert.equal(identity.oid, 'alice'); return value === id; },
    },
  });
  let listArguments: unknown[] = [];
  Object.assign(deps.files, { list: async (...args: unknown[]) => {
    listArguments = args;
    return { files: [{ name: 'file.txt', size: 3 }], continuationToken: 'next-page' };
  } });
  const app = await createGateway(config, deps);
  t.after(() => app.close());
  const headers = { authorization: 'Bearer alice', 'x-ms-client-principal': 'spoofed', 'x-ms-api-role': 'processor' };
  for (const url of ['/storage', '/jobs']) assert.equal((await app.inject(url)).statusCode, 401);
  assert.deepEqual((await app.inject({ url: '/storage?continuationToken=current-page', headers })).json(),
    { files: [{ name: 'file.txt', size: 3 }], continuationToken: 'next-page' });
  assert.deepEqual(listArguments, [
    `${config.tenantId}/alice/`, { continuationToken: 'current-page', maxPageSize: 100 },
  ]);
  assert.deepEqual((await app.inject({ url: '/jobs', headers })).json(), { jobs: [] });
  for (const payload of [{ name: '../other' }, { name: 'file.txt', status: 'completed' }, { name: 'file.txt', owner_oid: 'bob' }]) {
    assert.equal((await app.inject({ url: '/jobs', method: 'POST', headers, payload })).statusCode, 400);
  }
  const accepted = await app.inject({ url: '/jobs', method: 'POST', headers, payload: { name: 'file.txt' } });
  assert.equal(accepted.statusCode, 202);
  assert.deepEqual(accepted.json(), { id });
  assert.equal((await app.inject({ url: '/jobs/not-a-guid', method: 'DELETE', headers })).statusCode, 400);
  assert.equal((await app.inject({ url: `/jobs/${id}`, method: 'DELETE', headers })).statusCode, 204);
});

test('production gateway does not enable local-only file processing', async t => {
  const app = await createGateway(config, dependencies());
  t.after(() => app.close());
  assert.equal(Boolean((await app.inject('/auth/config')).json().capabilities.processing), false);
  const headers = { authorization: 'Bearer alice' };
  assert.equal((await app.inject({ url: '/jobs', headers })).statusCode, 503);
  assert.equal((await app.inject({ url: '/jobs', method: 'POST', headers, payload: { name: 'file.txt' } })).statusCode, 503);
  assert.equal((await app.inject({ url: '/diagnostics/traces', headers })).statusCode, 503);
});

test('retry routes authorize identity and reject invalid IDs or caller-managed payloads', async t => {
  const id = '11111111-1111-4111-8111-111111111111';
  const app = await createGateway(config, dependencies({ processing: {
    async create() { return id; }, async list() { return []; }, async delete() { return false; },
    async retry(identity, jobId) { assert.equal(identity.oid, 'alice'); assert.equal(jobId, id); return id; },
  } }));
  t.after(() => app.close());
  assert.equal((await app.inject({ method: 'POST', url: `/jobs/${id}/retry` })).statusCode, 401);
  const headers = { authorization: 'Bearer alice' };
  assert.equal((await app.inject({ method: 'POST', url: '/jobs/invalid/retry', headers })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: `/jobs/${id}/retry`, headers, payload: { owner_oid: 'bob' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: `/jobs/${id}/retry`, headers })).statusCode, 202);
});

test('foundation current-user responses retain top-level identity and report allowed access', async t => {
  const app = await createGateway(config, dependencies());
  t.after(() => app.close());
  const response = await app.inject({ url: '/auth/me', headers: { authorization: 'Bearer alice' } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(response.json(), { oid: 'alice', tenantId: config.tenantId, access: { allowed: true } });
});

test('role-based gateways reject a missing application role before startup', async () => {
  for (const requiredRole of [undefined, '']) {
    await assert.rejects(async () => {
      const app = await createGateway({ ...config, profile: 'role-based-data',
        ...(requiredRole === undefined ? {} : { requiredRole }) }, dependencies());
      await app.close();
    }, /Role-based-data requires a configured application role/);
  }
});

test('telemetry startup failures are server errors, not rejected access tokens', async t => {
  let upstream = 0;
  let tracing = 0;
  const unavailable = async (): Promise<never> => { throw new Error('Unexpected telemetry operation'); };
  const app = await createGateway(config, dependencies({
    telemetry: {
      begin() { tracing++; throw new Error('Telemetry startup failed'); },
      end: unavailable, operation: unavailable, list: async () => [], shutdown: async () => {},
    },
    fetch: async () => { upstream++; return Response.json({ value: [] }); },
  }));
  t.after(() => app.close());
  const headers = { authorization: 'Bearer alice' };
  assert.equal((await app.inject({ url: '/diagnostics/traces', headers })).statusCode, 200);
  assert.equal((await app.inject({ url: '/jobs', headers })).statusCode, 503);
  assert.equal((await app.inject({ url: '/api/Todo', headers: { authorization: 'Bearer invalid' } })).statusCode, 401);
  assert.equal(tracing, 0);
  const response = await app.inject({ url: '/api/Todo', headers });
  assert.equal(response.statusCode, 500);
  assert.equal(response.json().error, 'Service operation failed');
  assert.equal(tracing, 1);
  assert.equal(upstream, 0);
});

test('production gateway does not publish developer identity tooling or simulation APIs', async t => {
  const app = await createGateway(config, dependencies());
  t.after(() => app.close());
  for (const url of ['/__dev/identity', '/__dev/identity.js', '/developer.html', '/developer.js', '/local/users']) {
    assert.equal((await app.inject(url)).statusCode, 404, url);
  }
  assert.equal((await app.inject({ method: 'POST', url: '/local/session', payload: { preview: true } })).statusCode, 404);
});
