import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BlobServiceClient } from '@azure/storage-blob';
import { localTracing } from '../src/local-tracing.js';

test('trace listing downloads records in bounded parallel batches while preserving order', async t => {
  let active = 0;
  let maximum = 0;
  const names = Array.from({ length: 20 }, (_, index) => `trace-${index}`);
  const container = {
    async *listBlobsFlat() {
      for (const name of names) yield { name };
    },
    getBlockBlobClient(name: string) {
      const index = Number(name.slice('trace-'.length));
      return {
        async downloadToBuffer() {
          active++;
          maximum = Math.max(maximum, active);
          await new Promise(resolve => setTimeout(resolve, 5));
          active--;
          return Buffer.from(JSON.stringify({
            traceId: index.toString(16).padStart(32, '0'),
            spanId: index.toString(16).padStart(16, '0'),
            name, startedAt: '2026-10-11T00:00:00.000Z',
            durationMs: 1, status: 'ok',
          }));
        },
      };
    },
  };
  t.mock.method(BlobServiceClient, 'fromConnectionString', () => ({
    getContainerClient: () => container,
  }) as unknown as BlobServiceClient);
  const tracing = localTracing('UseDevelopmentStorage=true');
  t.after(() => tracing.shutdown());
  const records = await tracing.list({ oid: 'owner', tenantId: 'tenant', roles: [] });
  assert.deepEqual(records.map(record => record.name), names);
  assert.equal(maximum, 8);
});
