export function withFileLock<T>(lock: string, action: () => Promise<T>, attempts?: number): Promise<T>;
