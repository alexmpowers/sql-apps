import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeApplication, type ApplicationAdapter } from '../../../src/application.js';
import { application } from '../application.js';

const id = '11111111-1111-4111-8111-111111111111';
const subject = 'a'.repeat(64);

test('application rejects overlength UTF-16 input before procedure execution', async t => {
  let calls = 0;
  const app = await composeApplication(application, {
    profile: 'public-demo', capabilities: ['data', 'visitor-sessions'],
    async register() {}, async subject() { return subject; }, async ready() {},
    async execute(_name, parameters) {
      calls++;
      return [{ outcome: 'ok', id, title: parameters.title, completed: false }];
    },
  });
  t.after(() => app.close());
  const maximum = String.fromCodePoint(0x1F33F).repeat(100);
  for (const method of ['POST', 'PATCH'] as const) {
    const url = method === 'POST' ? '/api/todos' : `/api/todos/${id}`;
    assert.equal((await app.inject({ method, url, payload: { title: maximum + 'x' } })).statusCode, 400);
  }
  assert.equal(calls, 0);
  const accepted = await app.inject({ method: 'POST', url: '/api/todos', payload: { title: ` ${maximum} ` } });
  assert.equal(accepted.statusCode, 201);
  assert.equal(accepted.json().title, maximum);
  assert.equal(calls, 1);
});

test('application deletion requires the procedure to confirm the requested item', async t => {
  const itemId = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
  let deleted: { id: string | null; title: string | null; completed: boolean | null } = {
    id: null, title: 'Synthetic item', completed: false,
  };
  const app = await composeApplication(application, {
    profile: 'public-demo', capabilities: ['data', 'visitor-sessions'],
    async register() {}, async subject() { return subject; }, async ready() {},
    async execute() { return [{ outcome: 'ok', ...deleted }]; },
  });
  t.after(() => app.close());
  for (const invalid of [
    { id: null, title: 'Synthetic item', completed: false },
    { id: '22222222-2222-4222-8222-222222222222', title: 'Synthetic item', completed: false },
    { id: itemId, title: null, completed: false },
    { id: itemId, title: 'Synthetic item', completed: null },
  ]) {
    deleted = invalid;
    const response = await app.inject({ method: 'DELETE', url: `/api/todos/${itemId}` });
    assert.equal(response.statusCode, 502);
    assert.ok(response.json().requestId);
  }
  deleted = { id: itemId.toUpperCase(), title: 'Synthetic item', completed: false };
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/todos/${itemId}` })).statusCode, 204);
});

test('application rejects successful procedure results containing overlength UTF-16 titles', async t => {
  const app = await composeApplication(application, {
    profile: 'public-demo', capabilities: ['data', 'visitor-sessions'],
    async register() {}, async subject() { return subject; }, async ready() {},
    async execute() {
      return [{ outcome: 'ok', id, title: String.fromCodePoint(0x1F33F).repeat(100) + 'x', completed: false }];
    },
  });
  t.after(() => app.close());
  for (const request of [
    { method: 'GET' as const, url: '/api/todos' },
    { method: 'POST' as const, url: '/api/todos', payload: { title: 'Synthetic item' } },
    { method: 'PATCH' as const, url: `/api/todos/${id}`, payload: { completed: true } },
  ]) {
    const response = await app.inject(request);
    assert.equal(response.statusCode, 502);
    assert.ok(response.json().requestId);
  }
});

test('selected application uses the same registration and exact methods in both adapters', async t => {
  const manifests = [];
  for (const profile of ['local-simulation', 'public-demo'] as const) {
    const calls: { name: string; parameters: Record<string, string | boolean | null> }[] = [];
    const adapter: ApplicationAdapter = {
      profile, capabilities: ['data', 'visitor-sessions'],
      async register() {},
      async subject() { return subject; },
      async ready() {},
      async execute(name, parameters) {
        calls.push({ name, parameters });
        return [{ outcome: 'ok', id, title: 'Synthetic item', completed: false }];
      },
    };
    const app = await composeApplication(application, adapter);
    t.after(() => app.close());
    const routes = await app.inject('/application/manifest');
    assert.equal(routes.statusCode, 200);
    manifests.push(routes.json());
    assert.deepEqual(routes.json().routes, application.routes);
    assert.equal((await app.inject('/api/todos')).statusCode, 200);
    assert.deepEqual((await app.inject('/api/todos')).json(), { items: [{ id, title: 'Synthetic item', completed: false }] });
    const created = await app.inject({ method: 'POST', url: '/api/todos', payload: { title: ' Synthetic item ' } });
    assert.equal(created.statusCode, 201);
    assert.deepEqual(calls.at(-1), {
      name: 'Create', parameters: { token_hash: subject, title: 'Synthetic item' },
    });
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/todos/${id}`, payload: { completed: true } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/todos/${id}` })).statusCode, 204);
    for (const path of ['/api/Todo', '/graphql', '/local/session', '/storage', '/jobs']) {
      assert.equal((await app.inject(path)).statusCode, 404, path);
    }
  }
  assert.deepEqual(manifests[0], manifests[1], 'Profile differences must not change the application route contract');
});

test('selected composition rejects missing capabilities or changed route methods before readiness', async () => {
  const adapter: ApplicationAdapter = {
    profile: 'public-demo', capabilities: ['data'],
    async register() {}, async subject() { return subject; }, async ready() {}, async execute() { return []; },
  };
  await assert.rejects(composeApplication(application, adapter), /visitor-sessions/);
  await assert.rejects(composeApplication({
    ...application,
    routes: [...application.routes, { method: 'POST', path: '/api/missing' }],
  }, { ...adapter, capabilities: ['data', 'visitor-sessions'] }), /route contract/);
  await assert.rejects(composeApplication({
    ...application,
    routes: application.routes.map(route => route.method === 'PATCH' ? { ...route, method: 'PUT' } : route),
  }, { ...adapter, capabilities: ['data', 'visitor-sessions'] }), /route contract/);
});

test('application readiness probes its actual adapter and exposes failures as unavailable', async t => {
  const app = await composeApplication(application, {
    profile: 'public-demo', capabilities: ['data', 'visitor-sessions'],
    async register() {}, async subject() { return subject; },
    async ready() { throw new Error('SQL procedure cannot execute'); },
    async execute() { throw new Error('SQL offline'); },
  });
  t.after(() => app.close());
  assert.equal((await app.inject('/health/live')).statusCode, 200);
  assert.equal((await app.inject('/health/ready')).statusCode, 503);
  const failed = await app.inject('/api/todos');
  assert.equal(failed.statusCode, 500);
  assert.equal(failed.json().error, 'Service operation failed');
  assert.ok(failed.json().requestId);
});

test('application rejects owner fields, invalid input and malformed backend results', async t => {
  let calls = 0;
  let rows: unknown = [{ outcome: 'ok', id, title: 'Synthetic item', completed: false }];
  const app = await composeApplication(application, {
    profile: 'public-demo', capabilities: ['data', 'visitor-sessions'],
    async register() {}, async subject() { return subject; }, async ready() {},
    async execute() { calls++; return rows; },
  });
  t.after(() => app.close());
  for (const payload of [
    { title: '' }, { title: ' ' }, { title: 'x'.repeat(201) }, { title: 'item', owner_oid: id },
    { title: 'item', token_hash: subject }, { title: 'item', id }, { title: 'item', role: 'admin' },
  ]) {
    assert.equal((await app.inject({ method: 'POST', url: '/api/todos', payload })).statusCode, 400);
  }
  for (const payload of [{}, { owner_oid: id }, { title: 'x'.repeat(201) }, { completed: 'true' }]) {
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/todos/${id}`, payload })).statusCode, 400);
  }
  assert.equal((await app.inject('/api/todos?owner_oid=forged')).statusCode, 400);
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/todos/invalid' })).statusCode, 400);
  assert.equal(calls, 0);
  assert.equal((await app.inject({ method: 'POST', url: '/api/todos', payload: { title: 'x'.repeat(200) } })).statusCode, 201);
  for (const malformed of [[], {}, [{ outcome: 'ok', id }], [{ outcome: 'ok', id, title: 'item', completed: false, owner_oid: id }]]) {
    rows = malformed;
    assert.equal((await app.inject('/api/todos')).statusCode, 502);
  }
  for (const [outcome, expected] of [['expired', 401], ['quota', 409], ['rate_limited', 429], ['not_found', 404]] as const) {
    rows = [{ outcome, id: null, title: null, completed: null }];
    assert.equal((await app.inject({ method: 'POST', url: '/api/todos', payload: { title: 'item' } })).statusCode, expected);
  }
  rows = [{ outcome: 'ok', id: null, title: null, completed: null }];
  assert.deepEqual((await app.inject('/api/todos')).json(), { items: [] });
  assert.equal((await app.inject({ method: 'POST', url: '/api/todos', payload: { title: 'item' } })).statusCode, 502);
});
