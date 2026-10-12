import { readdir, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve(process.argv[2] ?? process.cwd());
if (process.argv.length > 3) throw new Error('Usage: test-examples.mjs [checkout]');
const files = [];
let examples;
try { examples = await readdir(join(root, 'examples'), { withFileTypes: true }); }
catch (error) { if (error.code !== 'ENOENT') throw error; examples = []; }
for (const example of examples) {
  if (!example.isDirectory()) continue;
  const directory = join(root, 'examples', example.name, 'tests');
  let tests;
  try { tests = await readdir(directory); }
  catch (error) { if (error.code !== 'ENOENT') throw error; continue; }
  for (const test of tests.sort()) {
    if (!test.endsWith('.test.ts')) continue;
    const compiled = join(root, 'dist', 'examples', example.name, 'tests', test.replace(/\.ts$/, '.js'));
    try {
      if (!(await lstat(compiled)).isFile()) throw new Error(`Compiled example test is not a file: ${compiled}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      throw new Error(`Missing compiled example test: ${compiled}; compile tests before running`);
    }
    files.push(compiled);
  }
}
if (!files.length) console.log('No optional example tests; foundation/application tests remain required.');
else {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit', shell: false, env });
  child.once('error', error => { console.error(error.message); process.exitCode = 1; });
  child.once('close', (code, signal) => {
    if (signal) console.error(`Example tests stopped by ${signal}`);
    process.exitCode = code ?? 1;
  });
}
