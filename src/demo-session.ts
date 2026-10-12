import { createHash, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApplicationError, type ApplicationServices } from './application.js';

export const sessionMinutes = 60;
const sessionResult = z.array(z.strictObject({
  outcome: z.enum(['ok', 'expired', 'capacity']),
  expires_at: z.string().nullable(),
})).length(1);

export function sessionCookieName(origin: string, secure: boolean): string {
  return secure ? '__Host-sql_apps_session' :
    `sql_apps_session_${createHash('sha256').update(origin).digest('hex').slice(0, 12)}`;
}
export function sessionToken(request: FastifyRequest, name: string): string | undefined {
  const matches = (request.headers.cookie ?? '').split(';').map(value => value.trim())
    .filter(value => value.slice(0, value.indexOf('=')) === name);
  if (!matches.length) return undefined;
  const token = matches[0]!.slice(name.length + 1);
  if (matches.length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new ApplicationError(400, 'Invalid visitor session cookie');
  }
  return token;
}
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}
export function sessionHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
export function sessionCookie(name: string, token: string, secure: boolean, clear = false): string {
  return `${name}=${clear ? '' : token}; Path=/; Max-Age=${clear ? 0 : sessionMinutes * 60}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}
export async function readSession(
  services: ApplicationServices, procedure: string, hash: string,
): Promise<{ expiresAt: string } | null> {
  const parsed = sessionResult.safeParse(await services.execute(procedure, { token_hash: hash }));
  if (!parsed.success) throw new ApplicationError(502, 'Invalid session procedure result');
  const row = parsed.data[0]!;
  if (row.outcome === 'capacity') {
    if (row.expires_at !== null) throw new ApplicationError(502, 'Invalid capacity result');
    throw new ApplicationError(429, 'The public demo has reached its active visitor limit; try again later');
  }
  if (row.outcome === 'expired') {
    if (row.expires_at !== null) throw new ApplicationError(502, 'Invalid expired session result');
    return null;
  }
  if (!row.expires_at || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z?$/.test(row.expires_at)) {
    throw new ApplicationError(502, 'Invalid session expiry');
  }
  const expires = Date.parse(row.expires_at.endsWith('Z') ? row.expires_at : `${row.expires_at}Z`);
  if (!Number.isFinite(expires)) throw new ApplicationError(502, 'Invalid session expiry');
  if (expires <= Date.now()) return null;
  return { expiresAt: new Date(expires).toISOString() };
}
