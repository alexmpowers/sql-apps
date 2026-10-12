import { z } from 'zod';
import { createSchema, identifier, itemSchema, updateSchema, type TodoItem } from '../contract.js';

const sessionSchema = z.strictObject({ expiresAt: z.iso.datetime() });
const listSchema = z.strictObject({ items: z.array(itemSchema) });
const api = (path: string) => `/api${path}`;
export class DemoApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'DemoApiError';
  }
}
export class DemoClient {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  private async request(path: string, options?: RequestInit): Promise<unknown> {
    const fetcher = this.fetcher;
    const response = await fetcher(path, { ...options, credentials: 'same-origin' });
    if (response.status === 204) return null;
    let body: unknown;
    try { body = await response.json(); }
    catch { throw new DemoApiError(response.ok ? 502 : response.status, 'Application did not return JSON'); }
    if (!response.ok) {
      const error = z.object({ error: z.string() }).safeParse(body);
      throw new DemoApiError(response.status, error.success ? error.data.error : `Application request failed (${response.status})`);
    }
    return body;
  }
  private parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) throw new Error('Invalid application response');
    return result.data;
  }
  async session() {
    return this.parse(sessionSchema, await this.request(api('/session')));
  }
  async start() {
    return this.parse(sessionSchema, await this.request(api('/session'), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ synthetic: true }),
    }));
  }
  async end(): Promise<void> {
    await this.request(api('/session'), { method: 'DELETE' });
  }
  async list(): Promise<TodoItem[]> {
    return this.parse(listSchema, await this.request(api('/todos'))).items;
  }
  async create(title: string): Promise<TodoItem> {
    return this.parse(itemSchema, await this.request(api('/todos'), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(createSchema.parse({ title })),
    }));
  }
  async update(id: string, changes: Partial<Pick<TodoItem, 'title' | 'completed'>>): Promise<TodoItem> {
    return this.parse(itemSchema, await this.request(api(`/todos/${identifier.parse(id)}`), {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(updateSchema.parse(changes)),
    }));
  }
  async delete(id: string): Promise<void> {
    await this.request(api(`/todos/${identifier.parse(id)}`), { method: 'DELETE' });
  }
}
