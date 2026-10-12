export type LocalAuthentication = { mode: 'preview' } | { mode: 'entra'; tenantId: string; clientId: string };

export function readLocalAuthentication(environment?: NodeJS.ProcessEnv): LocalAuthentication;
export function localAuthenticationMatches(value: unknown, expected: LocalAuthentication): boolean;
