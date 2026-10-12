export function roleBasedProfileProblem(config: unknown): string | undefined;
export function roleBasedDabProblem(dab: unknown, profile: { requiredRole: string; readinessPath: string }): string | undefined;
export function roleBasedProcedureProblem(dab: unknown, sqlTexts: string[]): string | undefined;
export function readSqlSources(root: string): Promise<string[]>;
