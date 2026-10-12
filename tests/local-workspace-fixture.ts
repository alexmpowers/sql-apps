import type { TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeWorkspace, runtimeFor } from '../src/workspace.mjs';

export async function localWorkspaceFixture(t: TestContext, selection?: number | 'legacy') {
  const home = await mkdtemp(join(tmpdir(), 'sql-apps-local-test-'));
  const original = process.cwd();
  t.after(async () => {
    process.chdir(original);
    await rm(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
  if (selection !== undefined) await initializeWorkspace(home, selection, async () => 'free');
  process.chdir(home);
  return runtimeFor();
}
