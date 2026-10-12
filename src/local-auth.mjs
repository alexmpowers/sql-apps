const uuid = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export function readLocalAuthentication(environment = process.env) {
  if (environment.NODE_ENV === 'production') throw new Error('Local authentication is disabled in production');
  const mode = environment.SQL_APPS_LOCAL_AUTH ?? 'preview';
  if (mode === 'preview') return { mode };
  if (mode !== 'entra') throw new Error('Local authentication must be preview or entra');
  const tenantId = environment.AZURE_TENANT_ID;
  const clientId = environment.API_CLIENT_ID;
  if (typeof tenantId !== 'string' || !uuid.test(tenantId) || typeof clientId !== 'string' || !uuid.test(clientId)) {
    throw new Error('Local Entra authentication requires AZURE_TENANT_ID and API_CLIENT_ID UUIDs');
  }
  return { mode, tenantId: tenantId.toLowerCase(), clientId: clientId.toLowerCase() };
}

export function localAuthenticationMatches(value, expected) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || value.mode !== expected.mode) return false;
  return expected.mode === 'preview' || (value.tenantId === expected.tenantId && value.clientId === expected.clientId);
}
