import { SqlAppsClient } from '../../src/client.js';
import { createSchema, itemSchema, updateSchema } from './contract.js';

export interface Todo { id: string; title: string; completed: boolean }

export class TodoExampleClient extends SqlAppsClient {
  async listTodos(): Promise<Todo[]> {
    const todos: Todo[] = [];
    let next: string | undefined = '/api/Todo';
    const visited = new Set<string>();
    while (next) {
      const url = new URL(next, this.origin);
      if (url.origin !== this.origin.origin || url.pathname !== '/api/Todo' ||
          url.username || url.password || url.hash || visited.has(url.href)) {
        throw new Error('Data API returned an invalid or repeated Todo continuation link');
      }
      visited.add(url.href);
      const body: unknown = await (await this.request(url.href)).json();
      if (typeof body !== 'object' || body === null || !('value' in body) || !Array.isArray(body.value)) {
        throw new Error('Data API returned an invalid Todo list');
      }
      todos.push(...body.value.map(parseTodo));
      if ('nextLink' in body) {
        if (typeof body.nextLink !== 'string' || !body.nextLink) throw new Error('Data API returned an invalid Todo continuation link');
        next = body.nextLink;
      } else next = undefined;
    }
    return todos;
  }
  async createTodo(title: string, id = crypto.randomUUID()): Promise<string> {
    await this.request('/api/Todo', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, ...createSchema.parse({ title }) }) });
    return id;
  }
  async updateTodo(id: string, changes: Partial<Pick<Todo, 'title' | 'completed'>>): Promise<void> {
    await this.request(`/api/Todo/id/${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', 'if-match': '*' },
      body: JSON.stringify(updateSchema.parse(changes)),
    });
  }
  async deleteTodo(id: string): Promise<void> {
    await this.request(`/api/Todo/id/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}

function parseTodo(value: unknown): Todo {
  if (typeof value !== 'object' || value === null || !('id' in value) || typeof value.id !== 'string' ||
      !('title' in value) || typeof value.title !== 'string' ||
      !itemSchema.shape.title.safeParse(value.title).success ||
      !('completed' in value) || typeof value.completed !== 'boolean') throw new Error('Data API returned an invalid Todo');
  return { id: value.id.toLowerCase(), title: value.title, completed: value.completed };
}
