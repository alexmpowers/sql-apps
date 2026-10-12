import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DemoClient } from '../web/client.js';
import { createSchema, itemSchema, updateSchema } from '../contract.js';

test('Todo contracts measure their SQL text limit in UTF-16 units', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  for (const title of ['x'.repeat(200), String.fromCodePoint(0x1F33F).repeat(100)]) {
    assert.equal(title.length, 200);
    assert.equal(createSchema.parse({ title: ` ${title} ` }).title, title);
    assert.equal(updateSchema.parse({ title }).title, title);
    assert.equal(itemSchema.parse({ id, title, completed: false }).title, title);
    for (const invalid of [title + 'x', title + String.fromCodePoint(0x1F33F)]) {
      assert.equal(createSchema.safeParse({ title: invalid }).success, false);
      assert.equal(updateSchema.safeParse({ title: invalid }).success, false);
      assert.equal(itemSchema.safeParse({ id, title: invalid, completed: false }).success, false);
    }
  }
  assert.equal(createSchema.safeParse({ title: '   ' }).success, false);
  assert.equal(itemSchema.parse({ id, title: ' Stored title ', completed: false }).title, ' Stored title ');
});

test('browser rejects overlength UTF-16 writes before sending a request', async () => {
  let calls = 0;
  const id = '11111111-1111-4111-8111-111111111111';
  const client = new DemoClient(async () => {
    calls++;
    return Response.json({ id, title: 'Synthetic item', completed: false });
  });
  const title = String.fromCodePoint(0x1F33F).repeat(100) + 'x';
  await assert.rejects(client.create(title));
  await assert.rejects(client.update(id, { title }));
  assert.equal(calls, 0);
});

test('browser rejects successful responses containing overlength UTF-16 titles', async () => {
  const item = { id: '11111111-1111-4111-8111-111111111111',
    title: String.fromCodePoint(0x1F33F).repeat(100) + 'x', completed: false };
  const client = new DemoClient(async (path, options) =>
    Response.json(String(path) === '/api/todos' && !options?.method ? { items: [item] } : item));
  await assert.rejects(client.list(), /Invalid application response/);
  await assert.rejects(client.create('Synthetic item'), /Invalid application response/);
  await assert.rejects(client.update(item.id, { completed: true }), /Invalid application response/);
});

test('selected browser client uses session cookies and common CRUD with no submitted owner identity', async () => {
  const calls: { path: string; body: unknown; method: string }[] = [];
  const id = '11111111-1111-4111-8111-111111111111';
  const client = new DemoClient(async (input, options) => {
    const path = String(input);
    assert.ok(path.startsWith('/'));
    assert.equal(options?.credentials, 'same-origin');
    assert.equal(new Headers(options?.headers).get('authorization'), null);
    calls.push({ path, body: options?.body ? JSON.parse(String(options.body)) : null, method: options?.method ?? 'GET' });
    if (options?.method === 'DELETE') return new Response(null, { status: 204 });
    if (path === '/api/session') return Response.json({ expiresAt: '2026-10-09T12:00:00.000Z' });
    const item = { id, title: 'Synthetic item', completed: false };
    return Response.json(path === '/api/todos' && !options?.method ? { items: [item] } : item);
  });
  assert.ok((await client.start()).expiresAt);
  assert.deepEqual(await client.list(), [{ id, title: 'Synthetic item', completed: false }]);
  assert.equal((await client.create('Synthetic item')).id, id);
  await client.update(id, { completed: true });
  await client.delete(id);
  await client.end();
  assert.deepEqual(calls, [
    { path: '/api/session', body: { synthetic: true }, method: 'POST' },
    { path: '/api/todos', body: null, method: 'GET' },
    { path: '/api/todos', body: { title: 'Synthetic item' }, method: 'POST' },
    { path: `/api/todos/${id}`, body: { completed: true }, method: 'PATCH' },
    { path: `/api/todos/${id}`, body: null, method: 'DELETE' },
    { path: '/api/session', body: null, method: 'DELETE' },
  ]);
});

test('browser client reports errors and rejects malformed public records without empty-list fallbacks', async () => {
  const malformed = new DemoClient(async () => Response.json({ items: [{ id: 'invalid', title: 'item' }] }));
  await assert.rejects(malformed.list(), /Invalid application response/);
  const unavailable = new DemoClient(async () => Response.json({ error: 'Session expired' }, { status: 401 }));
  await assert.rejects(unavailable.list(), /Session expired/);
  const nonJson = new DemoClient(async () => new Response('not json'));
  await assert.rejects(nonJson.list(), /JSON/);
});

test('browser fetch is invoked without a class receiver', async () => {
  const client = new DemoClient(async function (this: unknown) {
    assert.equal(this, undefined, 'Browser fetch must not receive DemoClient as its Window receiver');
    return Response.json({ items: [] });
  });
  assert.deepEqual(await client.list(), []);
});
