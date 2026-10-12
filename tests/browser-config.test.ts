import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBrowserConfig } from '../src/browser-config.js';

test('browser configuration discriminates real Entra from persona-free local preview', () => {
  for (const config of [
    { mode: 'entra', tenantId: 'tenant', clientId: 'client', scope: 'scope', capabilities: { files: true, functions: true } },
    { mode: 'local', capabilities: { files: false, functions: false } },
  ]) assert.deepEqual(parseBrowserConfig(config), config);
  assert.equal('users' in parseBrowserConfig({ mode: 'local', capabilities: { files: false, functions: false } }), false);
  assert.deepEqual(parseBrowserConfig({ tenantId: 'tenant', clientId: 'client', scope: 'scope' }),
    { mode: 'entra', tenantId: 'tenant', clientId: 'client', scope: 'scope', capabilities: { files: true, functions: true } });
  for (const config of [
    null, {}, { mode: 'unknown', capabilities: { files: true, functions: true } },
    { mode: 'local' },
    { mode: 'local', capabilities: { files: false } },
    { mode: 'local', capabilities: { files: false, functions: 'yes' } },
    { mode: 'entra', clientId: 'client', capabilities: { files: 'yes', functions: false } },
  ]) assert.throws(() => parseBrowserConfig(config), /Invalid/);
});

test('processing controls require an explicit boolean capability', () => {
  const config = { mode: 'local',
    capabilities: { files: true, functions: true, processing: true } };
  assert.deepEqual(parseBrowserConfig(config), config);
  assert.throws(() => parseBrowserConfig({ ...config, capabilities: { ...config.capabilities, processing: 'yes' } }), /Invalid/);
  assert.equal(parseBrowserConfig({ ...config, capabilities: { files: true, functions: true } }).capabilities.processing, undefined);
});

test('browser service and optional capabilities preserve booleans and reject other values', () => {
  for (const capability of ['files', 'functions', 'processing', 'jobSubmission', 'jobRetry', 'automaticProgress', 'tracing']) {
    for (const value of [false, true]) {
      const config = { mode: 'local', capabilities: { files: false, functions: false, [capability]: value } };
      assert.deepEqual(parseBrowserConfig(config), config);
    }
    for (const value of [undefined, null, 'true', 1, {}, []]) {
      assert.throws(() => parseBrowserConfig({
        mode: 'local', capabilities: { files: false, functions: false, [capability]: value },
      }), /Invalid/);
    }
  }
});

test('Entra browser configuration preserves the explicit local backend flag', () => {
  const config = { mode: 'entra', tenantId: 'tenant', clientId: 'client', scope: 'scope',
    capabilities: { files: false, functions: false } };
  assert.deepEqual(parseBrowserConfig(config), config);
  for (const localBackend of [false, true]) {
    assert.deepEqual(parseBrowserConfig({ ...config, localBackend }), { ...config, localBackend });
  }
});

test('Entra browser configuration rejects nonboolean local backend flags', () => {
  const config = { mode: 'entra', tenantId: 'tenant', clientId: 'client', scope: 'scope',
    capabilities: { files: false, functions: false } };
  for (const localBackend of [undefined, null, 'true', 1, {}, []]) {
    assert.throws(() => parseBrowserConfig({ ...config, localBackend }), /Invalid local backend configuration/);
  }
});
