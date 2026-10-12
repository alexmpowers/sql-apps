export type ReadinessDependency = 'data' | 'blob' | 'queue' | 'functions';

export class DependencyReadinessError extends Error {
  constructor(readonly dependency: ReadinessDependency, cause: unknown) {
    super(`Local ${dependency} readiness failed`, { cause });
    this.name = 'DependencyReadinessError';
  }
}

export async function probeReadiness(
  dependency: ReadinessDependency, action: () => Promise<void>,
): Promise<void> {
  try {
    await action();
  } catch (cause) {
    throw new DependencyReadinessError(dependency, cause);
  }
}
