import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const module = await import('../scripts/setup-check.mjs');

test('setup exposes a project-owned installation planner', async () => {
  assert.equal(typeof module.planInstallation, 'function');
});

function environment(platform, state = 'missing') {
  return {
    host: { name: 'fixture-host', platform, architecture: 'x64', release: 'fixture', distro: 'ubuntu', distroVersion: '24.04' },
    report: async () => ({ checks: [{ id: 'dotnet', toolState: state }, { id: 'docker-cli', toolState: state }] }),
    probe: async (command, args) => command === 'apt-cache' ?
      `dotnet-sdk-8.0:\n  Candidate: 8.0.421-0ubuntu1\n  Version table:\n     8.0.421-0ubuntu1 500\n        500 http://archive.ubuntu.com/ubuntu noble/main amd64 Packages\n` : command === 'brew' ? 'Homebrew 5.0.0' : 'v1.12.0',
  };
}

test('compatible tools and broken installed shims never produce install commands', async () => {
  for (const state of ['ready', 'check-failed', 'unsupported']) {
    const plan = await module.planInstallation(process.cwd(), 'dotnet', environment('win32', state));
    assert.equal(plan.command, null);
    assert.equal(plan.outcome, state === 'ready' ? 'ready' : 'manual');
  }
});

test('macOS SDK installation selects the versioned SDK 8 cask, not an evolving latest SDK', async () => {
  const plan = await module.planInstallation(process.cwd(), 'dotnet', environment('darwin'));
  assert.deepEqual(plan.command.args, ['install', '--cask', 'dotnet-sdk@8']);
});

test('a package manager with unrecognizable version output is not install-ready', async () => {
  const deps = { ...environment('win32'), probe: async () => 'broken shim without version' };
  assert.equal((await module.planInstallation(process.cwd(), 'dotnet', deps)).outcome, 'manual');
});

test('installation plans use existing managers across all three platforms without accepting licenses', async () => {
  for (const [platform, command] of [['win32', 'winget'], ['darwin', 'brew'], ['linux', 'sudo']]) {
    const plan = await module.planInstallation(process.cwd(), 'dotnet', environment(platform));
    assert.equal(plan.command.file, command);
    assert.equal(plan.outcome, 'approval-required');
    assert.ok(plan.effects.length > 0);
    assert.equal(plan.command.args.some(arg => arg.startsWith('--accept-')), false);
  }
});

test('missing managers, unknown Linux distributions and untrusted apt candidates require manual continuation', async () => {
  for (const deps of [
    { ...environment('darwin'), probe: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } },
    { ...environment('linux'), host: { ...environment('linux').host, distro: 'unknown' } },
    { ...environment('linux'), probe: async () => 'Candidate: 8.0.1\n https://unreviewed.invalid packages' },
  ]) {
    const plan = await module.planInstallation(process.cwd(), 'dotnet', deps);
    assert.equal(plan.outcome, 'manual');
    assert.equal(plan.command, null);
  }
});

test('APT candidates must match the selected distribution, release and exact official repository', async () => {
  for (const [tool, origin] of [
    ['dotnet', 'https://packages.microsoft.com/debian/12/prod bookworm/main'],
    ['dotnet', 'http://archive.ubuntu.com/ubuntu jammy/main'],
    ['docker', 'https://download.docker.com/linux/ubuntu-unreviewed noble/stable'],
  ]) {
    const version = tool === 'dotnet' ? '8.0.421-1' : '5:28.0.0-1';
    const deps = { ...environment('linux'), probe: async () =>
      `package:\n  Candidate: ${version}\n  Version table:\n     ${version} 500\n        500 ${origin} amd64 Packages\n` };
    assert.equal((await module.planInstallation(process.cwd(), tool, deps)).outcome, 'manual');
  }
});

test('reviewed installs reject stale plans and consume approval before a failed command', async t => {
  const home = await mkdtemp(join(tmpdir(), 'sql-apps-install-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const deps = environment('win32');
  const plan = await module.planInstallation(home, 'dotnet', deps);
  const path = join(home, 'approved.json');
  await writeFile(path, JSON.stringify(plan));
  let calls = 0;
  const runner = async () => { calls++; throw Object.assign(new Error('private output'), { code: 5 }); };
  const result = await module.installReviewed(path, home, { ...deps, runner });
  assert.equal(result.outcome, 'failed');
  assert.equal(JSON.stringify(result).includes('private output'), false);
  assert.equal(calls, 1);
  await assert.rejects(module.installReviewed(path, home, { ...deps, runner }), /consumed/);
  assert.equal(calls, 1);
  const changed = { ...plan, host: { ...plan.host, name: 'another-host' } };
  await writeFile(path, JSON.stringify(changed));
  await assert.rejects(module.installReviewed(path, home, { ...deps, runner }), /changed|stale/);
});

test('installer completion is re-probed and never reports a missing tool as ready', async t => {
  const home = await mkdtemp(join(tmpdir(), 'sql-apps-install-ready-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const deps = environment('win32');
  const path = join(home, 'approved.json');
  await writeFile(path, JSON.stringify(await module.planInstallation(home, 'dotnet', deps)));
  const result = await module.installReviewed(path, home, { ...deps, runner: async () => {} });
  assert.equal(result.outcome, 'restart-required');
  assert.equal(result.ready, false);
  await readFile(join(home, '.sql-apps', `install-${result.planId}.json`));
});
