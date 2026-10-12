import type { UserIdentity } from './auth.js';

export type ApplicationAccess = { allowed: true } | { allowed: false; requiredRole: string };
export type CurrentUser = UserIdentity & { access: ApplicationAccess };

export function accessFor(identity: UserIdentity, requiredRole?: string): ApplicationAccess {
  return requiredRole && !identity.roles?.includes(requiredRole) ?
    { allowed: false, requiredRole } : { allowed: true };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseCurrentUser(value: unknown): CurrentUser {
  if (!record(value) || typeof value.oid !== 'string' || !value.oid ||
      typeof value.tenantId !== 'string' || !value.tenantId ||
      (value.roles !== undefined && (!Array.isArray(value.roles) || !value.roles.every(role => typeof role === 'string'))) ||
      !record(value.access) || typeof value.access.allowed !== 'boolean') {
    throw new Error('Invalid current-user response');
  }
  let access: ApplicationAccess;
  if (value.access.allowed) {
    access = { allowed: true };
  } else {
    if (typeof value.access.requiredRole !== 'string' || !value.access.requiredRole.trim()) {
      throw new Error('Invalid current-user response');
    }
    access = { allowed: false, requiredRole: value.access.requiredRole };
  }
  return { oid: value.oid, tenantId: value.tenantId,
    ...(value.roles === undefined ? {} : { roles: value.roles }), access };
}
