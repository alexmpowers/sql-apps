import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const guid = z.string().uuid().transform(value => value.toLowerCase());
const item = z.object({ id: guid, title: z.string(), completed: z.boolean() });
const list = z.object({ items: z.array(z.object({ id: guid })) });

export async function acceptPublicApplication(origin: string, fetcher: typeof fetch): Promise<void> {
  const request = (path: string, init: RequestInit = {}) => fetcher(new URL(path, origin), {
    ...init, headers: { origin, ...init.headers }, signal: AbortSignal.timeout(10_000), redirect: 'error',
  });
  const start = async () => {
    const response = await request('/api/session', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ synthetic: true }),
    });
    const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
    if (response.status !== 201 || !cookie) throw new Error('Application acceptance could not create a session');
    return cookie;
  };
  const first = await start();
  const second = await start();
  let createdId: string | undefined;
  try {
    const created = await request('/api/todos', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: first },
      body: JSON.stringify({ title: `publication-${randomUUID()}` }),
    });
    if (created.status !== 201) throw new Error(`Application create returned ${created.status}`);
    const createdItem = item.parse(await created.json());
    createdId = createdItem.id;

    const firstList = await request('/api/todos', { headers: { cookie: first } });
    const firstItems = list.parse(await firstList.json());
    if (!firstList.ok || !firstItems.items.some(value => value.id === createdItem.id)) {
      throw new Error('Created item was not visible in its session');
    }

    const secondList = await request('/api/todos', { headers: { cookie: second } });
    const secondItems = list.parse(await secondList.json());
    if (!secondList.ok || secondItems.items.some(value => value.id === createdItem.id)) {
      throw new Error('Application session isolation failed');
    }

    const crossSessionUpdate = await request(`/api/todos/${createdItem.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', cookie: second },
      body: JSON.stringify({ completed: true }),
    });
    if (crossSessionUpdate.status !== 404) throw new Error('Another session could update an item');

    const updated = await request(`/api/todos/${createdItem.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', cookie: first },
      body: JSON.stringify({ completed: true }),
    });
    if (!updated.ok || !item.extend({ completed: z.literal(true) }).safeParse(await updated.json()).success) {
      throw new Error('Application update failed');
    }
  } finally {
    if (createdId) {
      const removed = await request(`/api/todos/${createdId}`, { method: 'DELETE', headers: { cookie: first } });
      if (removed.status !== 204) throw new Error(`Application cleanup returned ${removed.status}`);
    }
    for (const cookie of [first, second]) {
      const ended = await request('/api/session', { method: 'DELETE', headers: { cookie } });
      if (ended.status !== 204) throw new Error(`Application session cleanup returned ${ended.status}`);
    }
  }
}
