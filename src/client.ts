import { fileJobSchema, type FileJob } from './file-jobs.js';
import { z } from 'zod';
import { traceRecordSchema, type TraceRecord } from './trace-contract.js';

export interface ClientOptions {
  baseUrl: string;
  getAccessToken: () => Promise<string>;
  fetch?: typeof fetch;
}

export interface ClientFilePage {
  files: { name: string; size: number }[];
  continuationToken?: string;
}

export class ApiError extends Error {
  constructor(public readonly status: number) {
    super(`Application request failed (${status})`);
  }
}

export class SqlAppsClient {
  private readonly fetcher: typeof fetch;
  protected readonly origin: URL;
  constructor(private readonly options: ClientOptions) {
    this.origin = new URL(options.baseUrl);
    if (this.origin.username || this.origin.password || this.origin.pathname !== '/') {
      throw new Error('Client baseUrl must be an origin without embedded credentials');
    }
    this.fetcher = options.fetch ?? ((url, init) => fetch(url, init));
  }
  async request(path: string, options: RequestInit = {}): Promise<Response> {
    const url = new URL(path, this.origin);
    if (url.origin !== this.origin.origin) throw new Error('Cross-origin API paths are not allowed');
    const token = await this.options.getAccessToken();
    if (!token) throw new Error('Access token required');
    const headers = new Headers(options.headers);
    headers.set('authorization', `Bearer ${token}`);
    const response = await this.fetcher(url, {
      ...options, headers, redirect: 'error', signal: options.signal ?? AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new ApiError(response.status);
    return response;
  }
  async upload(name: string, bytes: Blob | Uint8Array): Promise<void> {
    await this.request(`/storage/${encodeURIComponent(name)}`, {
      method: 'PUT', headers: { 'content-type': 'application/octet-stream' },
      body: bytes instanceof Blob ? bytes : new Uint8Array(bytes).buffer,
    });
  }
  async download(name: string): Promise<ArrayBuffer> {
    return (await this.request(`/storage/${encodeURIComponent(name)}`)).arrayBuffer();
  }
  async deleteFile(name: string): Promise<void> {
    await this.request(`/storage/${encodeURIComponent(name)}`, { method: 'DELETE' });
  }
  async listFiles(continuationToken?: string): Promise<ClientFilePage> {
    const path = continuationToken === undefined ? '/storage' :
      `/storage?${new URLSearchParams({ continuationToken })}`;
    const page = z.object({
      files: z.array(z.object({ name: z.string(), size: z.number().nonnegative() })),
      continuationToken: z.string().min(1).max(2048).optional(),
    }).parse(await (await this.request(path)).json());
    return {
      files: page.files,
      ...(page.continuationToken ? { continuationToken: page.continuationToken } : {}),
    };
  }
  async listJobs(signal?: AbortSignal): Promise<FileJob[]> {
    return z.object({ jobs: z.array(fileJobSchema) }).parse(await (await this.request('/jobs', signal ? { signal } : {})).json()).jobs;
  }
  async processFile(name: string): Promise<string> {
    const response = await this.request('/jobs', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
    });
    return z.object({ id: z.string().uuid() }).parse(await response.json()).id;
  }
  async deleteJob(id: string): Promise<void> {
    await this.request(`/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
  async retryJob(id: string): Promise<string> {
    return z.object({ id: z.string().uuid() }).parse(await (await this.request(`/jobs/${encodeURIComponent(id)}/retry`, { method: 'POST' })).json()).id;
  }
  async listTraces(): Promise<TraceRecord[]> {
    return z.object({ traces: z.array(traceRecordSchema) }).parse(await (await this.request('/diagnostics/traces')).json()).traces;
  }
  async echo(input: unknown): Promise<unknown> {
    return (await this.request('/functions/echo', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    })).json();
  }
}
