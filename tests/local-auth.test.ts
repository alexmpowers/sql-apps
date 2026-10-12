import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLocalAuthentication, localAuthenticationMatches } from '../src/local-auth.mjs';

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const clientId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const entra = { mode: 'entra', tenantId, clientId } as const;

test('local authentication defaults only absent configuration to explicit preview', () => {
  assert.deepEqual(readLocalAuthentication({}), { mode: 'preview' });
  assert.deepEqual(readLocalAuthentication({ SQL_APPS_LOCAL_AUTH: 'preview' }), { mode: 'preview' });
});

test('local Entra authentication requires configured UUIDs and normalizes their case', () => {
  assert.deepEqual(readLocalAuthentication({
    SQL_APPS_LOCAL_AUTH: 'entra', AZURE_TENANT_ID: tenantId, API_CLIENT_ID: clientId,
  }), entra);
  assert.deepEqual(readLocalAuthentication({
    SQL_APPS_LOCAL_AUTH: 'entra', AZURE_TENANT_ID: tenantId.toUpperCase(), API_CLIENT_ID: clientId.toUpperCase(),
  }), entra);
});

test('local authentication rejects empty and unsupported modes without a preview fallback', () => {
  for (const SQL_APPS_LOCAL_AUTH of ['', 'swa']) {
    assert.throws(() => readLocalAuthentication({ SQL_APPS_LOCAL_AUTH }), /Local authentication must be preview or entra/);
  }
});

test('local Entra authentication fails closed on missing or invalid IDs', () => {
  for (const configuration of [
    {},
    { AZURE_TENANT_ID: tenantId },
    { API_CLIENT_ID: clientId },
    { AZURE_TENANT_ID: 'bad-tenant', API_CLIENT_ID: clientId },
    { AZURE_TENANT_ID: tenantId, API_CLIENT_ID: '' },
    { AZURE_TENANT_ID: tenantId, API_CLIENT_ID: 'bad-client' },
  ]) {
    assert.throws(() => readLocalAuthentication({ SQL_APPS_LOCAL_AUTH: 'entra', ...configuration }),
      /Local Entra authentication requires AZURE_TENANT_ID and API_CLIENT_ID UUIDs/);
  }
});

test('all local authentication modes are disabled in production', () => {
  for (const configuration of [
    {},
    { SQL_APPS_LOCAL_AUTH: 'preview' },
    { SQL_APPS_LOCAL_AUTH: 'entra', AZURE_TENANT_ID: tenantId, API_CLIENT_ID: clientId },
  ]) {
    assert.throws(() => readLocalAuthentication({ NODE_ENV: 'production', ...configuration }),
      /Local authentication is disabled in production/);
  }
});

test('local Entra attestation matches only the exact mode, tenant and client', () => {
  assert.equal(localAuthenticationMatches({ ...entra }, entra), true);
  for (const value of [
    undefined, null, {}, [], 'entra', { mode: 'preview' },
    { mode: 'entra' },
    { ...entra, tenantId: clientId },
    { ...entra, clientId: tenantId },
    { ...entra, tenantId: tenantId.toUpperCase() },
    { ...entra, clientId: clientId.toUpperCase() },
  ]) assert.equal(localAuthenticationMatches(value, entra), false);
});

test('missing attestation is not preview and explicit preview never attests Entra', () => {
  const preview = { mode: 'preview' } as const;
  assert.equal(localAuthenticationMatches(preview, preview), true);
  assert.equal(localAuthenticationMatches(preview, entra), false);
  for (const value of [undefined, null, {}, [], 'preview', entra]) {
    assert.equal(localAuthenticationMatches(value, preview), false);
  }
});
