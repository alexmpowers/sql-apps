import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { QueueClient } from '@azure/storage-queue';
import { BlobServiceClient } from '@azure/storage-blob';
import { z } from 'zod';
import { SqlAppsClient, ApiError } from './client.js';
import { developmentUsers, localAppOrigin } from './local-app.js';
import { ensureOwned, localFunctionsOrigin, serviceNames, storageConnection } from './local-services.js';
import { localJobData } from './local-job-data.js';
import { localOrigin, localPrincipal } from './local.js';
import { run } from './process.js';
import { maintainLocalJobs } from './local-maintenance.js';
import { localSettingsSchema } from './local-settings.js';
import { runtimeFor } from './workspace.mjs';

export async function testLocalServices(container: string): Promise<void> {
  const names = serviceNames(container);
  if (!await ensureOwned(names.storage, 'storage') || !await ensureOwned(names.functions, 'functions')) {
    throw new Error('Start project-owned services before running services-test');
  }
  const tokens: string[] = [];
  const files: { client: SqlAppsClient; name: string }[] = [];
  const jobs: { client: SqlAppsClient; id: string }[] = [];
  const state = z.object({ key: z.string(), secret: z.string() }).parse(JSON.parse(await readFile(names.state, 'utf8')));
  const data = localJobData(localOrigin);
  const owner = developmentUsers[0]!.id;
  const other = developmentUsers[1]!.id;
  const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  let functionsStopped = false;
  const offlineName = `${names.functions}-offline-proof`;
  let offlineStarted = false;
  let failure: unknown;
  const session = async (user: string) => {
    const response = await fetch(`${localAppOrigin}/local/session`, { method: 'POST',
      headers: { origin: localAppOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ user }) });
    assert.equal(response.status, 200);
    const { token } = z.object({ token: z.string() }).parse(await response.json());
    tokens.push(token);
    return new SqlAppsClient({ baseUrl: localAppOrigin, getAccessToken: async () => token,
      fetch: (url, options) => {
        const headers = new Headers(options?.headers);
        headers.set('origin', localAppOrigin);
        return fetch(url, { ...options, headers });
      } });
  };
  const denied = async (action: () => Promise<unknown>, statuses = [403, 404]) => {
    await assert.rejects(action, (error: unknown) => error instanceof ApiError && statuses.includes(error.status));
  };
  const wait = async (client: SqlAppsClient, id: string, status: 'completed' | 'failed') => {
    for (let attempt = 0; attempt < 120; attempt++) {
      const job = (await client.listJobs()).find(row => row.id === id);
      if (job?.status === status) return job;
      if (job?.status === 'failed' && status !== 'failed') throw new Error(`Processing failed: ${job.error}`);
      await new Promise(resolve => setTimeout(resolve, 1_000));
    }
    throw new Error(`Job did not become ${status}`);
  };
  try {
    const alice = await session(owner);
    const bob = await session(other);
    const name = `acceptance-${randomUUID()}.txt`;
    files.push({ client: alice, name }, { client: bob, name });
    const bytes = Buffer.alloc(4 * 1024 * 1024, 65);
    await alice.upload(name, bytes);
    assert.deepEqual(Buffer.from(await alice.download(name)), bytes, 'Exact 4 MiB Blob roundtrip');
    await denied(() => alice.upload(name, Buffer.alloc(bytes.length + 1)), [413]);
    assert.equal((await alice.listFiles()).files.find(file => file.name === name)?.size, bytes.length);
    assert.equal((await bob.listFiles()).files.some(file => file.name === name), false);
    await denied(() => bob.download(name));
    await denied(() => bob.deleteFile(name));
    await bob.upload(name, Buffer.from('Bob owns this separate file'));
    assert.equal(Buffer.from(await bob.download(name)).toString(), 'Bob owns this separate file');
    assert.deepEqual(Buffer.from(await alice.download(name)), bytes);
    console.log('Live Blob ownership, same-name isolation and exact 4 MiB boundary passed.');

    const echo = await alice.echo({ message: 'Real Functions host acceptance' });
    assert.deepEqual(echo, { result: { user: { oid: owner, tenantId }, input: { message: 'Real Functions host acceptance' } } });
    const anonymous = await fetch(`${localFunctionsOrigin}/api/echo`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(anonymous.status, 401, 'Local function requires its server-only secret');

    await run('docker', ['stop', names.functions]);
    functionsStopped = true;
    const id = await alice.processFile(name);
    jobs.push({ client: alice, id });
    assert.equal((await alice.listJobs()).find(job => job.id === id)?.status, 'queued');
    assert.equal((await bob.listJobs()).some(job => job.id === id), false);
    await denied(() => bob.deleteJob(id));
    await denied(() => alice.deleteJob(id), [409]);
    await denied(() => alice.request('/jobs', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, status: 'completed', owner_oid: other }) }), [400]);
    for (const method of ['PATCH', 'DELETE']) {
      await denied(() => alice.request(`/api/FileJob/id/${id}`, {
        method, headers: { ...(method === 'PATCH' ? { 'content-type': 'application/json' } : {}), 'x-ms-api-role': 'processor',
          'x-ms-client-principal': localPrincipal(other, 'access_as_user', 'processor') },
        ...(method === 'PATCH' ? { body: JSON.stringify({ status: 'completed' }) } : {}),
      }));
    }
    await assert.rejects(data.update(other, id, { status: 'completed' }), /404/);
    const directRead = await fetch(`${localOrigin}/api/FileJob/id/${id}`, { headers: {
      'x-ms-client-principal': localPrincipal(owner),
    } });
    assert.equal(directRead.status, 200);
    assert.equal(JSON.stringify(await directRead.json()).includes('blob_key'), false, 'Client cannot see private snapshot keys');
    await alice.upload(name, Buffer.from('replaced after enqueue'));
    await alice.deleteFile(name);
    await run('docker', ['start', names.functions]);
    functionsStopped = false;
    const completed = await wait(alice, id, 'completed');
    assert.equal(completed.byte_count, bytes.length, 'Processor reads immutable original snapshot');
    assert.equal(completed.line_count, 1);
    assert.equal(completed.sha256, createHash('sha256').update(bytes).digest('hex'));
    const queue = new QueueClient(storageConnection(state.key), 'file-jobs');
    const message = { id, oid: owner, tenantId, key: `${tenantId}/${owner}/jobs/${id}` };
    await queue.sendMessage(Buffer.from(JSON.stringify(message)).toString('base64'));
    await new Promise(resolve => setTimeout(resolve, 3_000));
    assert.deepEqual((await alice.listJobs()).find(job => job.id === id), completed, 'Duplicate delivery is idempotent');
    console.log('Real Functions HTTP/queue, snapshot integrity, role escalation denial and duplicate delivery passed.');

    const { localCommand } = await import('./local.js');
    await localCommand('data', container, run);
    await alice.upload(name, Buffer.from('DAB recreated without replacing Functions'));
    const recreatedDataId = await alice.processFile(name);
    jobs.push({ client: alice, id: recreatedDataId });
    const recreatedDataJob = await wait(alice, recreatedDataId, 'completed');
    assert.equal(recreatedDataJob.sha256,
      createHash('sha256').update('DAB recreated without replacing Functions').digest('hex'));
    console.log('Existing Functions processed a job after DAB recreation through stable Docker DNS.');

    const failedId = randomUUID();
    const failedKey = `${tenantId}/${owner}/jobs/${failedId}`;
    await data.create(owner, { id: failedId, filename: name, blob_key: failedKey });
    jobs.push({ client: alice, id: failedId });
    await queue.sendMessage(Buffer.from(JSON.stringify({ id: failedId, oid: owner, tenantId, key: failedKey })).toString('base64'));
    const failed = await wait(alice, failedId, 'failed');
    assert.ok(failed.error);
    console.log('Real queue retries and persisted failure status passed.');

    await run('docker', ['restart', names.storage]);
    assert.equal(Buffer.from(await bob.download(name)).toString(), 'Bob owns this separate file', 'Blob survives Azurite restart');
    assert.deepEqual((await alice.listJobs()).find(job => job.id === id), completed, 'SQL job results persist across service restart');
    console.log('Azurite volume persistence and SQL result persistence passed.');

    if (await ensureOwned(offlineName, 'functions')) throw new Error('A previous offline-proof container needs explicit cleanup');
    const network = z.object({ Internal: z.literal(true) }).parse(JSON.parse(
      await run('docker', ['network', 'inspect', '--format', '{{json .}}', names.network])));
    assert.equal(network.Internal, true);
    const address = async (name: string) => {
      const networks = z.record(z.string(), z.object({ IPAddress: z.string() })).parse(JSON.parse(
        await run('docker', ['inspect', '--format', '{{json .NetworkSettings.Networks}}', name])));
      return z.ipv4().parse(networks[names.network]?.IPAddress);
    };
    const runningImage = z.string().regex(/^sha256:[a-f0-9]{64}$/).parse(
      (await run('docker', ['inspect', '--format', '{{.Image}}', names.functions])).trim());
    await run('docker', ['stop', names.functions]);
    functionsStopped = true;
    await alice.upload(name, Buffer.from('offline\nprocessing'));
    const offlineId = await alice.processFile(name);
    jobs.push({ client: alice, id: offlineId });
    offlineStarted = true;
    await run('docker', ['run', '--detach', '--name', offlineName, '--label', 'sql-apps.local=functions',
      ...runtimeFor(container).labels,
      '--network', names.network, '--env', 'AzureWebJobsStorage', '--env', 'LOCAL_FUNCTION_SECRET', '--env', 'LOCAL_DAB_URL',
      '--env', 'FUNCTIONS_WORKER_RUNTIME=node', '--env', 'SQL_APPS_LOCAL_FUNCTIONS=true', runningImage],
    { env: { AzureWebJobsStorage: storageConnection(state.key, await address(names.storage)),
      LOCAL_DAB_URL: `http://${names.data}:5000`, LOCAL_FUNCTION_SECRET: state.secret },
      redact: [state.key, state.secret] });
    assert.equal((await run('docker', ['inspect', '--format', '{{.Image}}', offlineName])).trim(), runningImage,
      'Offline proof must use the actual running worker image, not a moved tag or newer local build');
    const offlineResult = await wait(alice, offlineId, 'completed');
    assert.equal(offlineResult.sha256, createHash('sha256').update('offline\nprocessing').digest('hex'));
    assert.equal(offlineResult.line_count, 2);
    const offlineNetworks = JSON.parse(await run('docker', ['inspect', '--format', '{{json .NetworkSettings.Networks}}', offlineName]));
    assert.deepEqual(Object.keys(offlineNetworks), [names.network], 'Offline worker has only an internal, no-egress network');
    await run('docker', ['rm', '--force', offlineName]);
    offlineStarted = false;
    await run('docker', ['start', names.functions]);
    functionsStopped = false;
    console.log('Identical Functions image processed a real job with no public network egress; offline binding startup passed.');

    const ownTraces = await alice.listTraces();
    const submitted = ownTraces.find(span => span.name === 'snapshot.sql.queue.submit' && span.jobId === id);
    const processed = ownTraces.find(span => span.name === 'queue.blob.analyze.sql.complete' && span.jobId === id);
    assert.ok(submitted && processed, 'OpenTelemetry recorded submission and real worker spans');
    assert.equal(processed.traceId, submitted.traceId);
    assert.equal(processed.parentSpanId, submitted.spanId, 'Queue delivery preserves trace parent');
    for (const name of ['blob.snapshot.write', 'sql.job.create', 'queue.job.send']) {
      const child = ownTraces.find(span => span.jobId === id && span.name === name);
      assert.ok(child, `Submission records ${name}`);
      assert.equal(child.traceId, submitted.traceId);
      assert.equal(child.parentSpanId, submitted.spanId);
    }
    for (const name of ['sql.job.processing', 'blob.snapshot.read', 'sql.job.complete']) {
      const child = ownTraces.find(span => span.jobId === id && span.name === name);
      assert.ok(child, `Worker records ${name}`);
      assert.equal(child.traceId, processed.traceId);
      assert.equal(child.parentSpanId, processed.spanId);
    }
    assert.equal(ownTraces.some(span => span.name === 'GET /jobs' && Date.parse(span.startedAt) >= Date.parse(submitted.startedAt)),
      false, 'Automatic polling does not amplify traces');
    assert.equal((await bob.listTraces()).some(span => span.traceId === submitted.traceId), false, 'Trace dashboard is owner-scoped');
    assert.equal(JSON.stringify(ownTraces).includes(state.secret), false);
    assert.equal(JSON.stringify(ownTraces).includes(state.key), false);
    console.log('Owner-scoped OpenTelemetry gateway/submission/worker correlation passed.');

    const stuckId = randomUUID();
    const stuckKey = `${tenantId}/${owner}/jobs/${stuckId}`;
    const blobService = BlobServiceClient.fromConnectionString(storageConnection(state.key));
    const fileContainer = blobService.getContainerClient('files');
    const snapshot = Buffer.from('retry immutable snapshot\nwithout original file');
    await fileContainer.getBlockBlobClient(stuckKey).uploadData(snapshot);
    await data.create(owner, { id: stuckId, filename: name, blob_key: stuckKey });
    jobs.push({ client: alice, id: stuckId });
    const aged = await fetch(`${localOrigin}/api/FileJob/id/${stuckId}`, {
      method: 'PATCH', headers: { 'x-ms-client-principal': localPrincipal(owner, 'access_as_user', 'processor'),
        'x-ms-api-role': 'processor', 'content-type': 'application/json', 'if-match': '*' },
      body: JSON.stringify({ updated_at: new Date(Date.now() - 61 * 60_000).toISOString() }),
    });
    assert.equal(aged.status, 200);
    const recovered = await wait(alice, stuckId, 'failed');
    assert.match(recovered.error!, /recovery timeout/);
    await denied(() => bob.retryJob(stuckId));
    await denied(() => alice.retryJob(id), [409]);
    await alice.deleteFile(name);
    const retriedId = await alice.retryJob(stuckId);
    jobs.push({ client: alice, id: retriedId });
    const retried = await wait(alice, retriedId, 'completed');
    assert.equal(retried.parent_job_id?.toLowerCase(), stuckId);
    assert.equal(retried.sha256, createHash('sha256').update(snapshot).digest('hex'));
    assert.equal((await data.get(owner, stuckId))?.status, 'failed', 'Retry preserves old delivery/history');
    console.log('Real scheduled recovery and immutable-snapshot retry/history passed.');
    await testRetention(blobService, data);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    const errors: unknown[] = [];
    if (offlineStarted) {
      try { await run('docker', ['rm', '--force', offlineName]); }
      catch (error) { errors.push(error); }
    }

    if (functionsStopped) {
      try { await run('docker', ['start', names.functions]); }
      catch (error) { errors.push(error); }
    }
    for (const fixture of jobs) {
      try {
        const row = await data.get(owner, fixture.id);
        if (row && !['completed', 'failed'].includes(row.status)) {
          await wait(fixture.client, fixture.id, 'completed');
        }
        await fixture.client.deleteJob(fixture.id);
      } catch (error) { errors.push(error); }
    }
    for (const fixture of files) {
      try { await fixture.client.deleteFile(fixture.name); }
      catch (error) { if (!(error instanceof ApiError && error.status === 404)) errors.push(error); }
    }
    for (const token of tokens) {
      try {
        const response = await fetch(`${localAppOrigin}/local/session`, { method: 'DELETE',
          headers: { origin: localAppOrigin, authorization: `Bearer ${token}` } });
        if (!response.ok) throw new Error(`Session cleanup failed (${response.status})`);
      } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError([...(failure ? [failure] : []), ...errors], 'Local service acceptance cleanup failed');
  }
}

async function testRetention(blobs: BlobServiceClient, data: ReturnType<typeof localJobData>) {
  const owner = randomUUID();
  const tenant = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const terminal = randomUUID();
  const active = randomUUID();
  const orphan = randomUUID();
  const files = blobs.getContainerClient('files');
  const traces = blobs.getContainerClient('traces');
  const prefix = `${tenant}/${owner}/`;
  const snapshotKeys = [terminal, active, orphan].map(id => `${prefix}jobs/${id}`);
  const sourceKey = `${prefix}source.txt`;
  const traceKey = `${prefix}retention-fixture.json`;
  try {
    for (const key of [...snapshotKeys, sourceKey]) await files.getBlockBlobClient(key).uploadData(Buffer.from('retention fixture'));
    await traces.getBlockBlobClient(traceKey).uploadData(Buffer.from('{}'));
    for (const id of [terminal, active]) await data.create(owner, { id, filename: 'source.txt', blob_key: `${prefix}jobs/${id}` });
    await data.update(owner, terminal, { status: 'completed' });
    const settings = localSettingsSchema.parse({ retentionDays: 1, staleJobMinutes: 10080, traceRetentionDays: 1 });
    const result = await maintainLocalJobs(data, files, traces, settings, Date.now() + 2 * 86400_000, [owner]);
    assert.equal(result.removedJobs, 1);
    assert.equal(result.removedSnapshots, 1);
    assert.equal(result.removedTraces, 1);
    assert.equal(result.recovered, 0);
    assert.equal(await data.get(owner, terminal), undefined);
    assert.equal((await data.get(owner, active))?.status, 'queued');
    assert.equal(await files.getBlockBlobClient(`${prefix}jobs/${active}`).exists(), true);
    assert.equal(await files.getBlockBlobClient(sourceKey).exists(), true, 'Retention never deletes source uploads');
    console.log('Real opt-in retention deletes only expired terminal jobs/orphans/traces and preserves active snapshots/source files.');
  } finally {
    for (const id of [terminal, active]) if (await data.get(owner, id)) await data.delete(owner, id);
    for (const key of [...snapshotKeys, sourceKey]) await files.getBlockBlobClient(key).deleteIfExists();
    await traces.getBlockBlobClient(traceKey).deleteIfExists();
  }
}
