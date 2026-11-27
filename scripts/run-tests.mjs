import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testsDirectory = path.join(root, 'tests');
const files = fs.readdirSync(testsDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.test.mjs'))
  .map((entry) => path.join(testsDirectory, entry.name))
  .sort();

if (files.length === 0) {
  console.error('No tests/*.test.mjs files found');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: root,
  stdio: 'inherit',
  shell: false
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.signal) {
  console.error('Test runner terminated by signal ' + result.signal);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
