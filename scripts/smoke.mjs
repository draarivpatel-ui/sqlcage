import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(root, 'bin', 'sqlcage.mjs');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlcage-smoke-'));

try {
  const cleanFile = path.join(scratch, 'clean.sql');
  const riskyFile = path.join(scratch, 'risky.sql');
  fs.writeFileSync(cleanFile, 'SELECT * FROM users WHERE id = $1;\n', 'utf8');
  fs.writeFileSync(riskyFile, 'SELECT 1; DROP TABLE users;\n', 'utf8');
  execFileSync(process.execPath, [bin, 'audit', cleanFile], { stdio: 'pipe' });
  let riskyStatus = 0;
  try {
    execFileSync(process.execPath, [bin, 'audit', riskyFile, '--json'], { stdio: 'pipe' });
  } catch (error) {
    riskyStatus = error.status;
  }
  if (riskyStatus !== 1) throw new Error('CLI risky audit did not exit 1');
  process.stdout.write('sqlcage CLI smoke passed\n');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
