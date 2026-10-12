export const authRedirectPath = '/auth/redirect.html';

export interface BrowserCapabilities {
  files: boolean;
  functions: boolean;
  processing?: boolean;
  jobSubmission?: boolean;
  jobRetry?: boolean;
  automaticProgress?: boolean;
  tracing?: boolean;
  progressIntervalMs?: number;
}

export type BrowserConfig =
  | { mode: 'entra'; tenantId: string; clientId: string; scope: string; localBackend?: boolean; capabilities: BrowserCapabilities }
  | { mode: 'local'; capabilities: BrowserCapabilities };

export function parseBrowserConfig(value: unknown): BrowserConfig {
  if (!value || typeof value !== 'object') throw new Error('Invalid browser configuration');
  const legacyEntra = !('mode' in value);
  const capabilities = 'capabilities' in value ? value.capabilities
    : legacyEntra ? { files: true, functions: true } : undefined;
  if (!capabilities || typeof capabilities !== 'object' || !('files' in capabilities) ||
      typeof capabilities.files !== 'boolean' || !('functions' in capabilities) || typeof capabilities.functions !== 'boolean') {
    throw new Error('Invalid browser service capabilities');
  }
  const services = { files: capabilities.files, functions: capabilities.functions };
  if ('processing' in capabilities) {
    if (typeof capabilities.processing !== 'boolean') throw new Error('Invalid browser processing capability');
    Object.assign(services, { processing: capabilities.processing });
  }
  const optional: Record<string, unknown> = { ...capabilities };
  for (const key of ['jobSubmission', 'jobRetry', 'automaticProgress', 'tracing'] as const) {
    if (key in optional) {
      if (typeof optional[key] !== 'boolean') throw new Error(`Invalid browser ${key} capability`);
      Object.assign(services, { [key]: optional[key] });
    }
  }
  if ('progressIntervalMs' in capabilities) {
    if (typeof capabilities.progressIntervalMs !== 'number' || !Number.isInteger(capabilities.progressIntervalMs) ||
        capabilities.progressIntervalMs < 1000 || capabilities.progressIntervalMs > 30000) throw new Error('Invalid progress interval');
    Object.assign(services, { progressIntervalMs: capabilities.progressIntervalMs });
  }
  if ('mode' in value && value.mode === 'local') return { mode: 'local', capabilities: services };
  if ((legacyEntra || ('mode' in value && value.mode === 'entra')) && 'tenantId' in value && typeof value.tenantId === 'string' && value.tenantId &&
      'clientId' in value && typeof value.clientId === 'string' && value.clientId &&
      'scope' in value && typeof value.scope === 'string' && value.scope) {
    const localBackend = 'localBackend' in value ? value.localBackend : undefined;
    if ('localBackend' in value && typeof localBackend !== 'boolean') throw new Error('Invalid local backend configuration');
    return { mode: 'entra', tenantId: value.tenantId, clientId: value.clientId, scope: value.scope,
      ...(typeof localBackend === 'boolean' ? { localBackend } : {}), capabilities: services };
  }
  throw new Error('Invalid browser authentication configuration');
}
