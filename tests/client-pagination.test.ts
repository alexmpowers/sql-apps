import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqlAppsClient } from '../src/client.js';

test('file listing reads exactly one page and forwards only the requested continuation', async () => {
  const requests: string[] = [];
  const client = new SqlAppsClient({
    baseUrl: 'https://app.example/',
    getAccessToken: async () => 'token',
    fetch: async input => {
      const url = new URL(String(input));
      requests.push(url.pathname + url.search);
      return Response.json(url.search
        ? { files: [{ name: 'second.txt', size: 2 }] }
        : { files: [{ name: 'first.txt', size: 1 }], continuationToken: 'opaque marker' });
    },
  });
  assert.deepEqual(await client.listFiles(), {
    files: [{ name: 'first.txt', size: 1 }], continuationToken: 'opaque marker',
  });
  assert.deepEqual(requests, ['/storage']);
});
