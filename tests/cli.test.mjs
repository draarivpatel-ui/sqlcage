import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(root, 'bin', 'sqlcage.mjs');

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    input: options.input,
    encoding: 'utf8',
    shell: false,
    windowsHide: true
  });
}

function withScratch(callback) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlcage-cli-test-'));
  try {
    return callback(scratch);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function writeSql(scratch, name, content) {
  const file = path.join(scratch, name);
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

test('CLI help exits zero and documents audit usage', () => {
  for (const args of [['--help'], ['-h']]) {
    const result = runCli(args);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /sqlcage audit <file-or-dash>/);
    assert.equal(result.stderr, '');
  }
});

test('CLI version exits zero', () => {
  const result = runCli(['--version']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^sqlcage 1\.0\.0/);
});

const usageErrorCases = [
  [],
  ['inspect'],
  ['audit'],
  ['audit', 'one.sql', 'two.sql'],
  ['audit', '--unknown'],
  ['audit', '--dialect'],
  ['audit', '-', '--dialect', 'pg'],
  ['audit', '-', '--dialect='],
  ['audit', '-', '--json=1'],
  ['--json', 'audit', '-'],
  ['audit', '-', '-x'],
  ['audit', '-', '--', 'extra']
];
for (const args of usageErrorCases) {
  test('CLI usage error exits 2 for ' + JSON.stringify(args), () => {
    const result = runCli(args, { input: 'SELECT 1' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Usage:/);
  });
}

const cleanSqlCases = [
  'SELECT 1;\n',
  'SELECT * FROM users WHERE id = $1;\n',
  'INSERT INTO users (id) VALUES (?);\n',
  'UPDATE users SET name = ? WHERE id = ?;\n',
  'DELETE FROM users WHERE id = ?;\n'
];
for (const sqlText of cleanSqlCases) {
  test('CLI audit exits 0 for clean file ' + JSON.stringify(sqlText.slice(0, 24)), () => {
    withScratch((scratch) => {
      const file = writeSql(scratch, 'clean.sql', sqlText);
      const result = runCli(['audit', file]);
      assert.equal(result.status, 0);
      assert.match(result.stdout, /clean/);
      assert.equal(result.stderr, '');
    });
  });
}

const riskySqlCases = [
  ['SELECT 1; SELECT 2;', 'SQLCAGE_MULTI_STATEMENT'],
  ['; SELECT 1;', 'SQLCAGE_MULTI_STATEMENT'],
  ['DROP TABLE users;', 'SQLCAGE_DANGEROUS_KEYWORD'],
  ['SELECT * INTO OUTFILE \'x\' FROM users;', 'SQLCAGE_DANGEROUS_KEYWORD'],
  ['COPY users FROM PROGRAM \'cat\';', 'SQLCAGE_DANGEROUS_KEYWORD'],
  ['SELECT 1 -- comment', 'SQLCAGE_COMMENT_TOKEN'],
  ['SELECT 1 /* comment */', 'SQLCAGE_COMMENT_TOKEN'],
  ['SELECT 1 # comment', 'SQLCAGE_COMMENT_TOKEN'],
  ['SELECT \'abc', 'SQLCAGE_UNBALANCED_QUOTE'],
  ['SELECT \0 1', 'SQLCAGE_NUL_BYTE']
];
for (const [sqlText, code] of riskySqlCases) {
  test('CLI audit exits 1 and reports ' + code, () => {
    withScratch((scratch) => {
      const file = writeSql(scratch, 'risky.sql', sqlText);
      const result = runCli(['audit', file]);
      assert.equal(result.status, 1);
      assert.match(result.stdout, new RegExp(code));
      assert.equal(result.stderr, '');
    });
  });
}

test('CLI JSON output is parseable and frozen-result-shaped', () => {
  withScratch((scratch) => {
    const file = writeSql(scratch, 'risky.sql', 'SELECT 1; DROP TABLE users;');
    const result = runCli(['audit', file, '--json']);
    assert.equal(result.status, 1);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.safe, false);
    assert.equal(Array.isArray(parsed.findings), true);
    assert.ok(parsed.findings.some((finding) => finding.code === 'SQLCAGE_MULTI_STATEMENT'));
    assert.ok(parsed.findings.some((finding) => finding.code === 'SQLCAGE_DANGEROUS_KEYWORD'));
    assert.equal(typeof parsed.stats.length, 'number');
  });
});

test('CLI JSON output for a clean file exits zero', () => {
  withScratch((scratch) => {
    const file = writeSql(scratch, 'clean.sql', 'SELECT 1;');
    const result = runCli(['audit', file, '--json']);
    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout).findings, []);
  });
});

test('CLI audits clean standard input through dash', () => {
  const result = runCli(['audit', '-'], { input: 'SELECT 1;' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /clean/);
});

test('CLI audits risky standard input through dash', () => {
  const result = runCli(['audit', '-'], { input: 'SELECT 1; DROP TABLE x;' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /SQLCAGE_MULTI_STATEMENT/);
});

test('CLI accepts dialect before or after the file', () => {
  withScratch((scratch) => {
    const file = writeSql(scratch, 'clean.sql', 'SELECT 1;');
    for (const args of [
      ['audit', file, '--dialect', 'mysql'],
      ['audit', file, '--dialect=sqlite'],
      ['audit', '--dialect', 'postgres', file]
    ]) {
      const result = runCli(args);
      assert.equal(result.status, 0, JSON.stringify(args));
    }
  });
});

test('CLI mysql dialect keeps mysql escaped strings lexically closed', () => {
  withScratch((scratch) => {
    const file = writeSql(scratch, 'clean.sql', "SELECT 'it\\'s fine';");
    const result = runCli(['audit', file, '--dialect', 'mysql']);
    assert.equal(result.status, 0);
  });
});

test('CLI exits 2 for a missing file', () => {
  const result = runCli(['audit', path.join(os.tmpdir(), 'sqlcage-file-that-does-not-exist.sql')]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /cannot open audit input/);
});

test('CLI exits 2 for a directory', () => {
  withScratch((scratch) => {
    const result = runCli(['audit', scratch]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /regular file/);
  });
});

test('CLI exits 2 for an oversized regular file', () => {
  withScratch((scratch) => {
    const file = path.join(scratch, 'oversized.sql');
    fs.writeFileSync(file, 'x'.repeat(1_048_577));
    const result = runCli(['audit', file]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /maximum audit size/);
  });
});

test('CLI rejects a FIFO when the platform supports FIFOs', (t) => {
  if (process.platform === 'win32') {
    t.skip('FIFOs are not available on Windows');
    return;
  }
  withScratch((scratch) => {
    const fifo = path.join(scratch, 'input.fifo');
    const mkfifo = spawnSync('mkfifo', [fifo], { encoding: 'utf8' });
    if (mkfifo.status !== 0) {
      t.skip('mkfifo is unavailable');
      return;
    }
    const result = runCli(['audit', fifo]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /regular file/);
  });
});

test('CLI rejects a symbolic link when symlink creation is available', (t) => {
  if (process.platform === 'win32') {
    t.skip('symlink creation can require privileges on Windows');
    return;
  }
  withScratch((scratch) => {
    const target = writeSql(scratch, 'target.sql', 'SELECT 1;');
    const link = path.join(scratch, 'linked.sql');
    try {
      fs.symlinkSync(target, link);
    } catch {
      t.skip('symlink creation is unavailable');
      return;
    }
    const result = runCli(['audit', link]);
    assert.equal(result.status, 2);
  });
});

test('CLI neutralizes ANSI control characters in usage errors', () => {
  const result = runCli(['audit', '-', '--bad-\x1b[31m-option'], { input: 'SELECT 1' });
  assert.equal(result.status, 2);
  assert.equal(result.stderr.includes('\x1b'), false);
  assert.match(result.stderr, /\?\[31m/);
});

test('CLI neutralizes control characters in file open errors', (t) => {
  if (process.platform === 'win32') {
    t.skip('control characters in filenames are not portable on Windows');
    return;
  }
  const missing = path.join(os.tmpdir(), 'sqlcage-missing-\x1b[31m.sql');
  const result = runCli(['audit', missing]);
  assert.equal(result.status, 2);
  assert.equal(result.stderr.includes('\x1b'), false);
});

test('CLI does not print raw SQL content in human findings', () => {
  withScratch((scratch) => {
    const secretish = 'SELECT 1; DROP TABLE very_sensitive_table_name;';
    const file = writeSql(scratch, 'risky.sql', secretish);
    const result = runCli(['audit', file]);
    assert.equal(result.status, 1);
    assert.equal(result.stdout.includes('very_sensitive_table_name'), false);
  });
});

test('CLI human output lists one line per finding', () => {
  withScratch((scratch) => {
    const file = writeSql(scratch, 'risky.sql', 'SELECT 1; DROP TABLE x;');
    const result = runCli(['audit', file]);
    const lines = result.stdout.trim().split('\n');
    assert.equal(lines[0].includes('finding(s)'), true);
    assert.ok(lines.length >= 3);
  });
});

test('CLI stdin input over one MiB exits 2 without reading unbounded data', () => {
  const result = runCli(['audit', '-'], { input: 'x'.repeat(1_048_577) });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /maximum audit size/);
});

test('CLI bin file is executable and starts with a node shebang', () => {
  const content = fs.readFileSync(bin, 'utf8');
  assert.equal(content.startsWith('#!/usr/bin/env node\n'), true);
  if (process.platform !== 'win32') {
    assert.equal(Boolean(fs.statSync(bin).mode & 0o111), true);
  }
});
