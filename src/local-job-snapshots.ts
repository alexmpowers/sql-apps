import type { BlobClient, BlobLeaseClient, ContainerClient } from '@azure/storage-blob';
import { deleteLocalJob, type localJobData } from './local-job-data.js';

function blobMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'BlobNotFound';
}

function leaseAlreadyHeld(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'LeaseAlreadyPresent';
}

const leaseSeconds = 60;
const renewalIntervalMs = 30_000;

function renewUntilStopped(lease: BlobLeaseClient) {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let renewal = Promise.resolve();
  let failure: unknown;
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      renewal = lease.renewLease()
        .then(() => { schedule(); })
        .catch(error => { failure = error; });
    }, renewalIntervalMs);
  };
  schedule();
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await renewal;
    if (failure) throw failure;
  };
}

async function leased<T>(lease: BlobLeaseClient, action: (leaseId: string) => Promise<T>): Promise<T> {
  const stopRenewal = renewUntilStopped(lease);
  let result: T | undefined;
  let failure: unknown;
  try {
    result = await action(lease.leaseId);
  } catch (error) {
    failure = error;
  }
  try {
    await stopRenewal();
  } catch (error) {
    failure = failure ?
      new AggregateError([failure, error], 'Job operation and snapshot lease renewal failed') : error;
  }
  try {
    await lease.releaseLease();
  } catch (error) {
    if (!blobMissing(error)) {
      failure = failure ?
        new AggregateError([failure, error], 'Job operation and snapshot lease release failed') : error;
    }
  }
  if (failure) throw failure;
  return result as T;
}

export async function withJobSnapshotLease<T>(blob: BlobClient, action: () => Promise<T>): Promise<T> {
  const lease = blob.getBlobLeaseClient();
  await lease.acquireLease(leaseSeconds);
  return leased(lease, action);
}

export async function tryWithJobSnapshotLease(blob: BlobClient, action: () => Promise<void>): Promise<boolean> {
  try {
    await withJobSnapshotLease(blob, action);
    return true;
  } catch (error) {
    if (leaseAlreadyHeld(error)) return false;
    throw error;
  }
}

export async function deleteLocalJobSnapshot(
  jobs: Pick<ReturnType<typeof localJobData>, 'get' | 'delete'>,
  files: ContainerClient, tenantId: string, oid: string, id: string,
): Promise<boolean> {
  const blob = files.getBlockBlobClient(`${tenantId}/${oid}/jobs/${id}`);
  const lease = blob.getBlobLeaseClient();
  try {
    await lease.acquireLease(leaseSeconds);
  } catch (error) {
    if (!blobMissing(error)) throw error;
    return deleteLocalJob(jobs, oid, id, async () => {});
  }
  return leased(lease, leaseId => deleteLocalJob(jobs, oid, id,
    () => blob.deleteIfExists({ conditions: { leaseId } })));
}
