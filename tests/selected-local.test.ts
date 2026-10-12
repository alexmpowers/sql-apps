import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import * as local from '../src/local.js';
import { initializeWorkspace } from '../src/workspace.mjs';
import type { Run } from '../src/process.js';
import * as selected from '../src/selected-local.js';

test('selected schema publishing reuses SQL tooling without writing into immutable inputs', async () => {
  assert.ok('publishLocalSchema' in local, 'Reusable selected schema publisher is missing');
  const publish = local.publishLocalSchema;
  assert.ok(typeof publish === 'function');
  const calls: { command: string; args: readonly string[] }[] = [];
  const project = join('immutable', 'database.sqlproj');
  const output = join('state', 'compiled');
  const intermediate = join('state', 'obj');
  const runner: Run = async (command, args, options) => {
    calls.push({ command, args });
    if (args.includes('{{json .Config.Env}}')) return JSON.stringify(['MSSQL_SA_PASSWORD=synthetic-secret']);
    if (args.some(arg => arg.includes('.NetworkSettings.Ports'))) return JSON.stringify([{ HostIp: '127.0.0.1', HostPort: '45005' }]);
    if (args.includes('/Action:Publish')) {
      assert.ok(options?.redact?.includes('synthetic-secret'));
      assert.ok(args.includes('/p:BlockOnPossibleDataLoss=True'));
      assert.ok(args.includes('/p:DropObjectsNotInSource=False'));
      assert.ok(args.some(arg => arg.includes('Database=selected_inventory;')));
    }
    return '';
  };
  const target = { database: 'selected_inventory', project, output, intermediate, runPostDeploy: true } as
    Parameters<typeof publish>[1] & { runPostDeploy: boolean };
  await publish('owned-sql', target, runner);
  const build = calls.find(call => call.args[0] === 'build');
  assert.deepEqual(build?.args, ['build', project, '--output', output,
    `-p:BaseIntermediateOutputPath=${intermediate}${sep}`]);
  assert.ok(calls.some(call => call.args.includes(`/SourceFile:${join(output, 'database.dacpac')}`)));
  assert.ok(calls.some(call => call.args.includes('/p:IgnorePostDeployScript=False')));
});

test('schema publishing does not restore an already verified SqlPackage installation', async () => {
  const calls: string[][] = [];
  await local.publishLocalSchema('owned-sql', { database: 'selected_inventory', project: 'sql/database.sqlproj', output: 'dist/sql' },
    async (command, args) => {
      calls.push([command, ...args]);
      if (args.includes('{{json .Config.Env}}')) return '["MSSQL_SA_PASSWORD=fixture-only"]';
      if (args.some(arg => arg.includes('.NetworkSettings.Ports'))) return '[{"HostIp":"127.0.0.1","HostPort":"1434"}]';
      return args.includes('/Version') ? '170.5.96.0' : '';
    });
  assert.equal(calls.some(call => call.includes('restore')), false);
  assert.ok(calls.some(call => call.includes('/Action:Publish')));
});

test('selected resource namespaces reject legacy mode and never reuse foundation database or DAB names', async t => {
  const home = await mkdtemp(join(tmpdir(), 'sql-apps-selected-local-'));
  t.after(() => rm(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  const runtime = await initializeWorkspace(home, 45000, async () => 'free');
  const a = selected.selectedLocalPaths(runtime, 'inventory');
  const b = selected.selectedLocalPaths(runtime, 'catalog');
  assert.notEqual(a.database, runtime.database);
  assert.notEqual(a.login, runtime.login);
  assert.notEqual(a.dataContainer, runtime.names.data);
  assert.notEqual(a.database, b.database);
  assert.notEqual(a.stateFile, b.stateFile);
  assert.ok(a.stateFile.startsWith(join(runtime.stateDirectory, 'applications', 'inventory')));
  assert.throws(() => selected.selectedLocalPaths({ ...runtime, mode: 'legacy' }, 'inventory'), /isolated/);
  assert.throws(() => selected.selectedLocalPaths(runtime, '../inventory'), /selection/);
});

test('selected startup rejects unverified inputs before issuing resource commands', async () => {
  assert.ok('prepareSelectedLocalApplication' in selected, 'Selected local startup is not wired');
  const prepare = selected.prepareSelectedLocalApplication;
  assert.ok(typeof prepare === 'function');
  let calls = 0;
  const runner: Run = async () => { calls++; throw new Error('Resource command must not run'); };
  await assert.rejects(prepare(process.cwd(), join(process.cwd(), '.sql-apps', 'not-an-artifact'), runner));
  assert.equal(calls, 0);
});

test('selected CLI documents startup, reuse and scoped stop rather than falling through to default services', async () => {
  const { run } = await import('../src/process.js');
  const help = await run(process.execPath, ['dist/src/local-cli.js', 'help']);
  assert.match(help, /selected-app/);
  assert.match(help, /selected-serve/);
  assert.match(help, /selected-stop/);
  assert.match(help, /selected-test/);
  await assert.rejects(run(process.execPath, ['dist/src/local-cli.js', 'selected-app']), /artifact directory/);
});

test('selected startup runs packaged post-deployment SQL and local CLI expands aggregate failures', async () => {
  const selectedSource = await import('node:fs/promises').then(fs => fs.readFile('src/selected-local.ts', 'utf8'));
  assert.match(selectedSource, /runPostDeploy:\s*true/);
  const cliSource = await import('node:fs/promises').then(fs => fs.readFile('src/local-cli.ts', 'utf8'));
  assert.match(cliSource, /AggregateError/);
  assert.match(cliSource, /\.errors/);
});
