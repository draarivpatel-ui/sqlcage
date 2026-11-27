#!/usr/bin/env node

import fs from 'node:fs';
import { auditSqlQuery, DIALECTS, SQLCAGE_VERSION } from '../src/index.mjs';

const MAX_FILE_BYTES = 1_048_576;
const READ_CHUNK_BYTES = 65_536;

function usageText() {
  return [
    'Usage:',
    '  sqlcage audit <file-or-dash> [--dialect postgres|mysql|sqlite] [--json]',
    '',
    'Commands:',
    '  audit    Audit one SQL file, or standard input when the file is -',
    '',
    'Options:',
    '  --dialect    SQL dialect for lexical scanning (default postgres)',
    '  --json       Print machine-readable audit JSON',
    '  --help       Show this help',
    '  --version    Show the sqlcage version'
  ].join('\n');
}

function neutralizeTerminalText(value) {
  return String(value).replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, '?');
}

function usageError(message) {
  const error = new Error(message);
  error.usage = true;
  return error;
}

function parseArguments(argv) {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    return { help: true };
  }
  if (argv.length === 1 && argv[0] === '--version') {
    return { version: true };
  }
  if (argv.length === 0 || argv[0] !== 'audit') {
    throw usageError('expected the audit command');
  }
  const result = { command: 'audit', dialect: 'postgres', json: false, file: undefined };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      result.json = true;
      continue;
    }
    if (argument === '--dialect') {
      index += 1;
      if (index >= argv.length) throw usageError('--dialect requires a value');
      result.dialect = argv[index];
      continue;
    }
    if (argument.startsWith('--dialect=')) {
      result.dialect = argument.slice('--dialect='.length);
      continue;
    }
    if (argument.startsWith('-') && argument !== '-') {
      throw usageError('unknown option ' + neutralizeTerminalText(argument));
    }
    if (result.file !== undefined) {
      throw usageError('audit accepts exactly one file');
    }
    result.file = argument;
  }
  if (result.file === undefined) {
    throw usageError('audit requires a file path or -');
  }
  if (!DIALECTS.includes(result.dialect)) {
    throw usageError('dialect must be one of postgres, mysql, or sqlite');
  }
  return result;
}

function readFully(fd, maximumBytes, sourceName) {
  const chunks = [];
  const chunk = Buffer.allocUnsafe(READ_CHUNK_BYTES);
  let total = 0;
  for (;;) {
    let bytesRead;
    try {
      bytesRead = fs.readSync(fd, chunk, 0, chunk.length, null);
    } catch (error) {
      if (error && error.code === 'EINTR') continue;
      throw error;
    }
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > maximumBytes) {
      throw new Error(sourceName + ' exceeds the maximum audit size of ' + maximumBytes + ' bytes');
    }
    chunks.push(Buffer.from(chunk.subarray(0, bytesRead)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function readAuditInput(file) {
  if (file === '-') {
    return readFully(0, MAX_FILE_BYTES, 'standard input');
  }
  let initialStat;
  try {
    initialStat = fs.lstatSync(file);
  } catch (error) {
    throw new Error('cannot open audit input: ' + neutralizeTerminalText(error.message));
  }
  if (initialStat.isSymbolicLink()) {
    throw new Error('audit input must be a regular file, not a symbolic link');
  }
  if (!initialStat.isFile()) {
    throw new Error('audit input must be a regular file, not a directory, FIFO, device, or socket');
  }
  const noFollow = fs.constants.O_NOFOLLOW === undefined ? 0 : fs.constants.O_NOFOLLOW;
  const nonBlocking = fs.constants.O_NONBLOCK === undefined ? 0 : fs.constants.O_NONBLOCK;
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | noFollow | nonBlocking);
  } catch (error) {
    throw new Error('cannot open audit input: ' + neutralizeTerminalText(error.message));
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) {
      throw new Error('audit input must be a regular file, not a directory, FIFO, device, or socket');
    }
    if (stat.size > MAX_FILE_BYTES) {
      throw new Error('audit input exceeds the maximum audit size of ' + MAX_FILE_BYTES + ' bytes');
    }
    return readFully(fd, MAX_FILE_BYTES, 'audit input');
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // The descriptor is already gone or the close failed after the read path finished.
    }
  }
}

function printHumanAudit(result) {
  if (result.safe) {
    process.stdout.write('sqlcage audit: clean\n');
    return;
  }
  process.stdout.write('sqlcage audit: ' + result.findings.length + ' finding(s)\n');
  for (const finding of result.findings) {
    const token = finding.token === undefined ? '' : ' [' + neutralizeTerminalText(finding.token) + ']';
    process.stdout.write(
      '- ' + neutralizeTerminalText(finding.code) +
      ' at index ' + finding.index + token +
      ': ' + neutralizeTerminalText(finding.message) + '\n'
    );
  }
}

async function main() {
  let parsed;
  try {
    parsed = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write('sqlcage: ' + neutralizeTerminalText(error.message) + '\n');
    process.stderr.write(usageText() + '\n');
    process.exitCode = 2;
    return;
  }
  if (parsed.help) {
    process.stdout.write(usageText() + '\n');
    return;
  }
  if (parsed.version) {
    process.stdout.write('sqlcage ' + SQLCAGE_VERSION + '\n');
    return;
  }

  let sqlText;
  try {
    sqlText = readAuditInput(parsed.file);
  } catch (error) {
    process.stderr.write('sqlcage: ' + neutralizeTerminalText(error.message) + '\n');
    process.exitCode = 2;
    return;
  }

  let result;
  try {
    result = auditSqlQuery(sqlText, { dialect: parsed.dialect });
  } catch (error) {
    process.stderr.write('sqlcage: ' + neutralizeTerminalText(error.message) + '\n');
    process.exitCode = 2;
    return;
  }

  if (parsed.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    printHumanAudit(result);
  }
  process.exitCode = result.safe ? 0 : 1;
}

await main();
