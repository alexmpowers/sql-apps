import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { resolve } from 'node:path';
import { bearerToken, type VerifyUser, type UserIdentity } from './auth.js';
import { accessFor } from './access.js';
import type { RuntimeConfig } from './config.js';
import { objectKey, type FileStore } from './storage.js';
import type { BrowserConfig } from './browser-config.js';
import type { FileJob } from './file-jobs.js';
import { z } from 'zod';
import type { LocalTracing } from './local-tracing.js';
import type { TraceParent } from './trace-contract.js';
import type { Span } from '@opentelemetry/api';
import { DependencyReadinessError } from './readiness.js';

export interface FileProcessing {
  list(identity: UserIdentity): Promise<FileJob[]>;
  create(identity: UserIdentity, name: string, parent?: TraceParent): Promise<string>;
  retry?(identity: UserIdentity, id: string, parent?: TraceParent): Promise<string>;
  delete(identity: UserIdentity, id: string): Promise<boolean>;
}

export interface GatewayDependencies {
  verifyUser: VerifyUser;
  files: FileStore;
  fetch: typeof fetch;
  functionToken: () => Promise<string>;
  browserConfig?: BrowserConfig;
  requestGuard?: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  processing?: FileProcessing;
  telemetry?: LocalTracing;
  ready?: () => Promise<void>;
}

interface AuthenticatedRequest extends FastifyRequest {
  identity: UserIdentity | null;
  accessToken: string | null;
  traceSpan: Span | null;
}

export async function createGateway(config: RuntimeConfig, dependencies: GatewayDependencies) {
  const requiredRole = config.profile === 'role-based-data' ? config.requiredRole : undefined;
  if (config.profile === 'role-based-data' && !requiredRole) {
    throw new Error('Role-based-data requires a configured application role');
  }
  const app = Fastify({
    bodyLimit: 4 * 1024 * 1024,
    logger: { redact: ['req.headers.authorization', 'req.headers.cookie'], level: 'info' },
    requestTimeout: 35_000,
  });
  app.decorateRequest('identity', null);
  app.decorateRequest('accessToken', null);
  app.decorateRequest('traceSpan', null);
  app.addHook('onResponse', async (request, reply) => {
    const span = (request as AuthenticatedRequest).traceSpan;
    if (span && dependencies.telemetry) await dependencies.telemetry.end(span, reply.statusCode >= 400);
  });
  if (dependencies.telemetry) app.addHook('onClose', () => dependencies.telemetry!.shutdown());
  if (dependencies.requestGuard) app.addHook('onRequest', dependencies.requestGuard);
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });
  app.setErrorHandler((error, request, reply) => {
    const status = typeof error === 'object' && error !== null && 'statusCode' in error &&
      typeof error.statusCode === 'number' ? error.statusCode : 500;
    request.log.error({ requestId: request.id, errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Request failed');
    void reply.code(status).send({
      error: status >= 500 ? 'Service operation failed' : error instanceof Error ? error.message : 'Invalid request',
      requestId: request.id,
    });
  });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https://login.microsoftonline.com; frame-src 'self' https://login.microsoftonline.com; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
  });
  app.get('/health/live', async () => ({ status: 'live' }));
  app.get('/health/ready', async (_request, reply) => {
    try {
      if (dependencies.ready) {
        await dependencies.ready();
        return { status: 'ready' };
      }
      const response = await dependencies.fetch(new URL('/health', config.dabUrl), { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) return reply.code(503).send({ status: 'not-ready' });
      return { status: 'ready' };
    } catch (error) {
      const dependency = error instanceof DependencyReadinessError ? error.dependency : undefined;
      app.log.warn({ errorType: error instanceof Error ? error.name : 'UnknownError',
        ...(dependency ? { dependency } : {}) }, 'Dependency readiness check failed');
      return reply.code(503).send({ status: 'not-ready', ...(dependency ? { dependency } : {}) });
    }
  });
  app.get('/auth/config', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return dependencies.browserConfig ?? {
      mode: 'entra',
      tenantId: config.tenantId,
      clientId: config.apiClientId,
      scope: `api://${config.apiClientId}/access_as_user`,
      capabilities: { files: config.profile !== 'role-based-data', functions: config.profile !== 'role-based-data' },
    };
  });
  await app.register(async protectedRoutes => {
    protectedRoutes.addHook('onRequest', async (request, reply) => {
      const token = bearerToken(request.headers.authorization);
      if (!token) return reply.code(401).send({ error: 'Bearer access token required' });
      let identity: UserIdentity;
      try {
        identity = await dependencies.verifyUser(token);
      } catch (error) {
        request.log.warn({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Access token rejected');
        return reply.code(401).send({ error: 'Invalid access token' });
      }
      const authenticated = request as AuthenticatedRequest;
      authenticated.identity = identity;
      authenticated.accessToken = token;
      if (request.routeOptions.url !== '/auth/me' && !accessFor(identity, requiredRole).allowed) {
        return reply.code(403).send({ error: 'Authorized role required' });
      }
      if (dependencies.telemetry && request.routeOptions.url !== '/diagnostics/traces' &&
          !(request.method === 'GET' && request.routeOptions.url === '/jobs')) {
        authenticated.traceSpan = dependencies.telemetry.begin(identity, `${request.method} ${request.routeOptions.url}`);
      }
    });
    protectedRoutes.addHook('onSend', async (_request, reply) => {
      reply.header('cache-control', 'no-store');
    });
    protectedRoutes.get('/auth/me', async request => {
      const identity = (request as AuthenticatedRequest).identity!;
      return { ...identity, access: accessFor(identity, requiredRole) };
    });
    protectedRoutes.route({
      method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      url: '/api/*',
      handler: proxyData,
    });
    protectedRoutes.post('/graphql', proxyData);
    if (config.profile !== 'role-based-data') {
    protectedRoutes.get('/storage', async (request, reply) => {
      if (!dependencies.files.list) return reply.code(503).send({ error: 'File listing unavailable' });
      const query = z.strictObject({ continuationToken: z.string().min(1).max(2048).optional() }).safeParse(request.query);
      if (!query.success) return reply.code(400).send({ error: 'Invalid file continuation token' });
      const identity = (request as AuthenticatedRequest).identity!;
      return dependencies.files.list(`${identity.tenantId}/${identity.oid}/`, {
        ...(query.data.continuationToken ? { continuationToken: query.data.continuationToken } : {}),
        maxPageSize: 100,
      });
    });
    protectedRoutes.get('/jobs', async (request, reply) => {
      if (!dependencies.processing) return reply.code(503).send({ error: 'File processing unavailable' });
      return { jobs: await dependencies.processing.list((request as AuthenticatedRequest).identity!) };
    });
    protectedRoutes.get('/diagnostics/traces', async (request, reply) => {
      if (!dependencies.telemetry) return reply.code(503).send({ error: 'Local tracing unavailable' });
      return { traces: await dependencies.telemetry.list((request as AuthenticatedRequest).identity!) };
    });
    protectedRoutes.post('/jobs', async (request, reply) => {
      if (!dependencies.processing) return reply.code(503).send({ error: 'File processing unavailable' });
      const body = z.strictObject({ name: z.string() }).safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'A file name is required; job fields are server managed' });
      const identity = (request as AuthenticatedRequest).identity!;
      try { objectKey(identity.tenantId, identity.oid, body.data.name); }
      catch { return reply.code(400).send({ error: 'Invalid file name' }); }
      const id = await dependencies.processing.create(identity, body.data.name, (request as AuthenticatedRequest).traceSpan?.spanContext());
      return reply.code(202).send({ id });
    });
    protectedRoutes.post('/jobs/:id/retry', async (request, reply) => {
      if (!dependencies.processing?.retry) return reply.code(503).send({ error: 'Job retry unavailable' });
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
      if (!params.success || request.body !== undefined) return reply.code(400).send({ error: 'Retry requires a job id and no body' });
      const authenticated = request as AuthenticatedRequest;
      const id = await dependencies.processing.retry(authenticated.identity!, params.data.id, authenticated.traceSpan?.spanContext());
      return reply.code(202).send({ id });
    });
    protectedRoutes.delete('/jobs/:id', async (request, reply) => {
      if (!dependencies.processing) return reply.code(503).send({ error: 'File processing unavailable' });
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid job id' });
      return reply.code(await dependencies.processing.delete((request as AuthenticatedRequest).identity!, params.data.id) ? 204 : 404).send();
    });
    }

    async function proxyData(request: FastifyRequest, reply: import('fastify').FastifyReply) {
      const url = new URL(config.dabUrl);
      const incoming = new URL(request.raw.url ?? '/', 'http://gateway.invalid');
      url.pathname = incoming.pathname;
      url.search = incoming.search;
      const headers = new Headers({ authorization: `Bearer ${(request as AuthenticatedRequest).accessToken}` });
      if (request.headers['if-match'] === '*') headers.set('if-match', '*');
      if (config.profile === 'role-based-data') headers.set('x-ms-api-role', config.requiredRole!);
      if (request.body !== undefined) headers.set('content-type', 'application/json');
      const response = await dependencies.fetch(url, {
        method: request.method,
        headers,
        ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
      reply.code(response.status);
      reply.header('content-type', response.headers.get('content-type') ?? 'application/json');
      return reply.send(response.body ?? undefined);
    }

    if (config.profile !== 'role-based-data') {
    protectedRoutes.route({
      method: ['PUT', 'GET', 'DELETE'],
      url: '/storage/:name',
      handler: async (request, reply) => {
        const params = request.params as { name: string };
        const identity = (request as AuthenticatedRequest).identity!;
        let key: string;
        try {
          key = objectKey(identity.tenantId, identity.oid, params.name);
        } catch {
          return reply.code(400).send({ error: 'Invalid file name' });
        }
        if (request.method === 'PUT') {
          if (!Buffer.isBuffer(request.body)) return reply.code(415).send({ error: 'Use application/octet-stream' });
          await dependencies.files.put(key, request.body);
          return reply.code(204).send();
        }
        if (request.method === 'DELETE') {
          return reply.code(await dependencies.files.delete(key) ? 204 : 404).send();
        }
        const file = await dependencies.files.get(key);
        if (!file) return reply.code(404).send({ error: 'File not found' });
        reply.header('content-disposition', 'attachment');
        return reply.type(file.contentType).send(file.bytes);
      },
    });
    protectedRoutes.post('/functions/echo', async (request, reply) => {
      const identity = (request as AuthenticatedRequest).identity!;
      const token = await dependencies.functionToken();
      const response = await dependencies.fetch(new URL('/api/echo', config.functionsUrl), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ user: identity, input: request.body }),
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
      return reply.code(response.status).type('application/json')
        .send(response.body ?? undefined);
    });
    }
  });
  await app.register(fastifyStatic, { root: resolve(config.publicDirectory), index: ['index.html'] });
  return app;
}
