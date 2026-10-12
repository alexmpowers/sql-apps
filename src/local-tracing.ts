import { ROOT_CONTEXT, trace, TraceFlags, SpanStatusCode, type Span } from '@opentelemetry/api';
import { BasicTracerProvider, SimpleSpanProcessor, type SpanExporter } from '@opentelemetry/sdk-trace-base';
import { BlobServiceClient } from '@azure/storage-blob';
import type { UserIdentity } from './auth.js';
import { traceRecordSchema, type TraceRecord, type TraceParent } from './trace-contract.js';

export function localTracing(connection: string) {
  const container = BlobServiceClient.fromConnectionString(connection, {
    retryOptions: { maxTries: 1, tryTimeoutInMs: 3000 },
  }).getContainerClient('traces');
  const exporter: SpanExporter = {
    export(spans, callback) {
      void Promise.all(spans.map(async span => {
        const oid = String(span.attributes['user.oid']);
        const tenant = String(span.attributes['user.tenant']);
        const context = span.spanContext();
        const start = span.startTime[0] * 1000 + span.startTime[1] / 1e6;
        const record: TraceRecord = {
          traceId: context.traceId, spanId: context.spanId,
          ...(span.parentSpanContext ? { parentSpanId: span.parentSpanContext.spanId } : {}),
          name: span.name, startedAt: new Date(start).toISOString(),
          durationMs: span.duration[0] * 1000 + span.duration[1] / 1e6,
          status: span.status.code === SpanStatusCode.ERROR ? 'error' : 'ok',
          ...(typeof span.attributes['job.id'] === 'string' ? { jobId: span.attributes['job.id'] } : {}),
        };
        const newestFirst = String(9999999999999 - Math.floor(start)).padStart(13, '0');
        await container.getBlockBlobClient(`${tenant}/${oid}/${newestFirst}-${context.traceId}-${context.spanId}.json`)
          .uploadData(Buffer.from(JSON.stringify(record)), { blobHTTPHeaders: { blobContentType: 'application/json' } });
      })).then(() => callback({ code: 0 }), error => {
        console.error('Local trace export failed', { errorType: error instanceof Error ? error.name : 'UnknownError' });
        callback({ code: 1, error: error instanceof Error ? error : new Error('Trace export failed') });
      });
    },
    async shutdown() {},
  };
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const tracer = provider.getTracer('sql-apps-local');
  return {
    begin(identity: UserIdentity, name: string, parent?: TraceParent): Span {
      const context = parent ? trace.setSpanContext(ROOT_CONTEXT, { ...parent, traceFlags: TraceFlags.SAMPLED, isRemote: true }) : ROOT_CONTEXT;
      return tracer.startSpan(name, { attributes: { 'user.oid': identity.oid, 'user.tenant': identity.tenantId } }, context);
    },
    async end(span: Span, failed = false) {
      span.setStatus({ code: failed ? SpanStatusCode.ERROR : SpanStatusCode.OK });
      span.end();
      await provider.forceFlush();
    },
    async operation<T>(identity: UserIdentity, name: string, action: (parent: TraceParent, span: Span) => Promise<T>, parent?: TraceParent): Promise<T> {
      const span = this.begin(identity, name, parent);
      try {
        const result = await action(span.spanContext(), span);
        await this.end(span);
        return result;
      } catch (error) { await this.end(span, true); throw error; }
    },
    async list(identity: UserIdentity): Promise<TraceRecord[]> {
      const names: string[] = [];
      for await (const blob of container.listBlobsFlat({ prefix: `${identity.tenantId}/${identity.oid}/` })) {
        if (names.length >= 100) break;
        names.push(blob.name);
      }
      const result: TraceRecord[] = [];
      for (let index = 0; index < names.length; index += 8) {
        result.push(...await Promise.all(names.slice(index, index + 8).map(async name =>
          traceRecordSchema.parse(JSON.parse((await container.getBlockBlobClient(name).downloadToBuffer()).toString())))));
      }
      return result;
    },
    async shutdown() { await provider.shutdown(); },
  };
}
export type LocalTracing = ReturnType<typeof localTracing>;
