import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ContainerClient } from '@azure/storage-blob';
import { localSettingsSchema } from '../src/local-settings.js';
import { localTenantId, maintainLocalJobs, maintenanceAction, sqlTime } from '../src/local-maintenance.js';
import { watchJobProgress } from '../src/web/job-progress.js';
import { fileJobSchema, jobMessageSchema } from '../src/file-jobs.js';
import { localJobData } from '../src/local-job-data.js';

test('local feature settings have safe defaults and reject typos or unbounded timers/retention', () => {
  assert.equal(localSettingsSchema.parse({}).retentionDays, 0);
  assert.equal(localSettingsSchema.parse({}).staleJobMinutes, 60);
  for (const value of [
    { retentionDays: -1 }, { retentionDays: 366 }, { progressIntervalMs: 999 },
    { staleJobMinutes: 4 }, { tracing: 'true' }, { unknownFlag: true },
  ]) assert.equal(localSettingsSchema.safeParse(value).success, false);
});

test('reconciliation and retention use exact UTC thresholds and never expire active jobs', () => {
  const now = Date.parse('2026-10-08T12:00:00Z');
  const settings = localSettingsSchema.parse({});
  const row = fileJobSchema.parse({ id: '11111111-1111-4111-8111-111111111111', filename: 'sample.txt',
    status: 'queued', sha256: null, byte_count: null, line_count: null, error: null, updated_at: '2026-10-08T11:00:00' });
  assert.equal(maintenanceAction(row, settings, now - 1), undefined);
  assert.equal(maintenanceAction(row, settings, now), 'recover');
  assert.equal(maintenanceAction({ ...row, status: 'completed' }, settings, now + 100 * 86400_000), undefined);
  const enabled = { ...settings, retentionDays: 1 };
  assert.equal(maintenanceAction({ ...row, status: 'completed' }, enabled, sqlTime(row.updated_at) + 86400_000 - 1), undefined);
  assert.equal(maintenanceAction({ ...row, status: 'failed' }, enabled, sqlTime(row.updated_at) + 86400_000), 'remove');
  assert.equal(maintenanceAction({ ...row, status: 'processing' }, enabled, now + 86400_000), 'recover');
  assert.throws(() => sqlTime(undefined), /missing/);
  assert.throws(() => sqlTime('invalid'), /Invalid/);
});

for (const sqlFails of [true, false]) {
  test(`terminal retention ${sqlFails ? 'preserves the snapshot when SQL deletion fails' : 'deletes SQL before the snapshot'}`, async t => {
    const oid = '22222222-2222-4222-8222-222222222222';
    const row = fileJobSchema.parse({
      id: '11111111-1111-4111-8111-111111111111', filename: 'sample.txt',
      status: 'failed', sha256: null, byte_count: null, line_count: null,
      error: 'worker failed', updated_at: '2026-10-08T11:00:00Z',
    });
    const calls: string[] = [];
    const failure = new Error('SQL unavailable');
    const jobs = localJobData('http://127.0.0.1:15000', async (_url, options) => {
      if (options?.method === 'DELETE') {
        calls.push('sql');
        if (sqlFails) throw failure;
        return new Response(null, { status: 204 });
      }

      return Response.json({ value: [row] });
    });
    const files = new ContainerClient('https://storage.invalid/files');
    const traces = new ContainerClient('https://storage.invalid/traces');
    const key = `${localTenantId}/${oid}/jobs/${row.id}`;
    const snapshot = files.getBlockBlobClient(key);
    const lease = snapshot.getBlobLeaseClient();
    t.mock.method(snapshot, 'getBlobLeaseClient', () => lease);
    t.mock.method(lease, 'acquireLease', async () => ({ leaseId: lease.leaseId }));
    t.mock.method(lease, 'releaseLease', async () => ({}));
    t.mock.method(files, 'getBlockBlobClient', (name: string) => {
      assert.equal(name, key);
      return snapshot;
    });
    t.mock.method(snapshot, 'deleteIfExists', async () => {
      calls.push('blob');
      return { succeeded: true };
    });
    t.mock.method(files, 'listBlobsFlat', async function* () {});
    t.mock.method(traces, 'listBlobsFlat', async function* () {});
    const action = () => maintainLocalJobs(jobs, files, traces,
      localSettingsSchema.parse({ retentionDays: 1 }), Date.parse('2026-10-10T12:00:00Z'), [oid]);
    if (sqlFails) {
      await assert.rejects(action(), error => error === failure);
      assert.deepEqual(calls, ['sql']);
    } else {
      const result = await action();
      assert.equal(result.removedJobs, 1);
      assert.deepEqual(calls, ['sql', 'blob']);
    }
  });
}

test('retention cannot delete a timed-out job while its worker holds the snapshot lease', async t => {
  const oid = '22222222-2222-4222-8222-222222222222';
  const row = fileJobSchema.parse({
    id: '11111111-1111-4111-8111-111111111111', filename: 'sample.txt', status: 'failed',
    sha256: null, byte_count: null, line_count: null, error: 'recovery timeout',
    updated_at: '2026-10-08T11:00:00Z',
  });
  let sqlDeleted = false;
  let snapshotDeleted = false;
  const jobs = localJobData('http://127.0.0.1:15000', async (_url, options) => {
    if (options?.method === 'DELETE') sqlDeleted = true;
    return Response.json({ value: [row] });
  });
  const files = new ContainerClient('https://storage.invalid/files');
  const traces = new ContainerClient('https://storage.invalid/traces');
  const snapshot = files.getBlockBlobClient(`${localTenantId}/${oid}/jobs/${row.id}`);
  const lease = snapshot.getBlobLeaseClient();
  const conflict = Object.assign(new Error('Snapshot is leased by a live worker'), { statusCode: 409, code: 'LeaseAlreadyPresent' });
  t.mock.method(files, 'getBlockBlobClient', () => snapshot);
  t.mock.method(snapshot, 'getBlobLeaseClient', () => lease);
  t.mock.method(lease, 'acquireLease', async () => { throw conflict; });
  t.mock.method(snapshot, 'deleteIfExists', async () => { snapshotDeleted = true; return { succeeded: true }; });
  t.mock.method(files, 'listBlobsFlat', async function* () {});
  t.mock.method(traces, 'listBlobsFlat', async function* () {});
  await assert.rejects(maintainLocalJobs(jobs, files, traces, localSettingsSchema.parse({ retentionDays: 1 }),
    Date.parse('2026-10-10T12:00:00Z'), [oid]), error => error === conflict);
  assert.equal(sqlDeleted, false);
  assert.equal(snapshotDeleted, false);
});

test('stale recovery skips a job while its worker holds the snapshot lease', async t => {
  const oid = '22222222-2222-4222-8222-222222222222';
  const row = fileJobSchema.parse({
    id: '11111111-1111-4111-8111-111111111111', filename: 'sample.txt', status: 'processing',
    sha256: null, byte_count: null, line_count: null, error: null, updated_at: '2026-10-08T11:00:00Z',
  });
  let updated = false;
  const jobs = localJobData('http://127.0.0.1:15000', async (_url, options) => {
    if (options?.method === 'PATCH') updated = true;
    return Response.json({ value: [row] });
  });
  const files = new ContainerClient('https://storage.invalid/files');
  const traces = new ContainerClient('https://storage.invalid/traces');
  const snapshot = files.getBlockBlobClient(`${localTenantId}/${oid}/jobs/${row.id}`);
  const lease = snapshot.getBlobLeaseClient();
  const conflict = Object.assign(new Error('Snapshot is leased by a live worker'), {
    statusCode: 409, code: 'LeaseAlreadyPresent',
  });
  t.mock.method(files, 'getBlockBlobClient', () => snapshot);
  t.mock.method(snapshot, 'getBlobLeaseClient', () => lease);
  t.mock.method(lease, 'acquireLease', async () => { throw conflict; });
  t.mock.method(files, 'listBlobsFlat', async function* () {});
  t.mock.method(traces, 'listBlobsFlat', async function* () {});
  const result = await maintainLocalJobs(jobs, files, traces, localSettingsSchema.parse({}),
    Date.parse('2026-10-10T12:00:00Z'), [oid]);
  assert.equal(updated, false);
  assert.equal(result.recovered, 0);
});

test('progress polling never overlaps, pauses while unavailable, backs off and cancels', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  let available = false;
  let fail = false;
  let release: (() => void) | undefined;
  const reports: unknown[] = [];
  const stop = watchJobProgress({
    intervalMs: 1000, available: () => available,
    report: error => { reports.push(error); },
    refresh: async signal => {
      calls++; assert.equal(signal.aborted, false);
      if (fail) throw new Error('dependency unavailable');
      await new Promise<void>(resolve => { release = resolve; });
    },
  });
  t.after(stop);
  t.mock.timers.tick(1000);
  assert.equal(calls, 0);
  available = true;
  t.mock.timers.tick(1000);
  assert.equal(calls, 1);
  t.mock.timers.tick(10000);
  assert.equal(calls, 1);
  release!();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(reports, [undefined]);
  fail = true;
  t.mock.timers.tick(1000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
  t.mock.timers.tick(1999);
  assert.equal(calls, 2);
  t.mock.timers.tick(1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 3);
  stop();
  t.mock.timers.tick(30000);
  assert.equal(calls, 3);
});

test('queue trace context is validated and status updates always carry a fresh timestamp', async () => {
  const job = { id: '11111111-1111-4111-8111-111111111111', oid: '22222222-2222-4222-8222-222222222222',
    tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', key: 'snapshot' };
  assert.equal(jobMessageSchema.safeParse({ ...job, trace: { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) } }).success, true);
  assert.equal(jobMessageSchema.safeParse({ ...job, trace: { traceId: 'secret', spanId: 'token' } }).success, false);
  const before = Date.now();
  const data = localJobData('http://127.0.0.1:15000', async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    assert.equal(body.status, 'failed');
    assert.ok(Date.parse(body.updated_at) >= before);
    return new Response(null, { status: 204 });
  });
  await data.update(job.oid, job.id, { status: 'failed' });
});
