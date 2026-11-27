import test from 'node:test';
import assert from 'node:assert/strict';
import { CODE, auditSqlQuery } from '../src/index.mjs';
import { assertThrowsCode } from './test-utils.mjs';

function codesFor(query, options) {
  return auditSqlQuery(query, options).findings.map((finding) => finding.code);
}

function hasCode(query, code, options) {
  return codesFor(query, options).includes(code);
}

const cleanQueries = [
  'SELECT 1',
  'SELECT 1;',
  'SELECT * FROM users WHERE id = $1',
  'INSERT INTO users (id, name) VALUES ($1, $2)',
  'UPDATE users SET name = $1 WHERE id = $2',
  'DELETE FROM users WHERE id = $1',
  'SELECT "select" FROM users',
  'SELECT "DROP" FROM users',
  "SELECT 'DROP TABLE users'",
  "SELECT '-- not a comment'",
  'SELECT "/* not a comment */"',
  'SELECT `mysql_identifier`',
  'SELECT 1;;',
  'SELECT 1;   \n\t',
  'SELECT $$DROP TABLE users$$',
  'SELECT $tag$-- inside dollar quote$tag$',
  'WITH x AS (SELECT 1) SELECT * FROM x',
  'SELECT array[1], json_col->>\'key\' FROM t',
  'SELECT 1\nFROM dual'
];

for (const query of cleanQueries) {
  test('auditor treats clean query as safe: ' + JSON.stringify(query.slice(0, 45)), () => {
    const result = auditSqlQuery(query);
    assert.equal(result.safe, true);
    assert.deepEqual(result.findings, []);
  });
}

const multiStatements = [
  'SELECT 1; SELECT 2',
  'SELECT 1;SELECT 2',
  'SELECT 1;\nSELECT 2',
  'SELECT 1;\tDELETE FROM users WHERE id = $1',
  'SELECT 1; ; SELECT 2',
  '; SELECT 1',
  'SELECT 1; INSERT INTO x VALUES (1)',
  'SELECT 1; DROP TABLE users',
  'SELECT 1;--x\nSELECT 2',
  'SELECT 1;/*x*/SELECT 2',
  'SELECT 1;\n\n(SELECT 2)',
  'SELECT 1; VALUES (1)',
  'SELECT 1; WITH x AS (SELECT 1) SELECT * FROM x',
  'SELECT 1; SELECT \'semi;inside\'',
  'SELECT 1; SELECT 2; SELECT 3'
];

for (const query of multiStatements) {
  test('auditor detects stacked statement: ' + JSON.stringify(query.slice(0, 45)), () => {
    assert.equal(hasCode(query, CODE.MULTI_STATEMENT), true);
    assert.equal(auditSqlQuery(query).safe, false);
    assert.ok(auditSqlQuery(query).stats.statements >= 1);
  });
}



test('ordinary two-statement SQL counts two executable statements', () => {
  assert.equal(auditSqlQuery('SELECT 1; SELECT 2').stats.statements, 2);
});

test('a single trailing semicolon is not a stacked statement', () => {
  assert.equal(auditSqlQuery('SELECT 1;').safe, true);
  assert.equal(auditSqlQuery('SELECT 1;').stats.statements, 1);
});

test('comments after a trailing semicolon do not create another statement but are still findings', () => {
  const result = auditSqlQuery('SELECT 1; -- trailing');
  assert.equal(result.stats.statements, 1);
  assert.equal(hasCode('SELECT 1; -- trailing', CODE.MULTI_STATEMENT), false);
  assert.equal(hasCode('SELECT 1; -- trailing', CODE.COMMENT_TOKEN), true);
});

const commentCases = [
  ['SELECT 1 -- comment', '--', 9],
  ['SELECT 1--comment', '--', 8],
  ['--comment\nSELECT 1', '--', 0],
  ['SELECT 1 /* comment */', '/*', 9],
  ['/* comment */ SELECT 1', '/*', 0],
  ['SELECT /*x*/ 1', '/*', 7],
  ['SELECT 1 # comment', '#', 9],
  ['#comment\nSELECT 1', '#', 0],
  ['SELECT 1#comment', '#', 8]
];
for (const [query, token, index] of commentCases) {
  test('auditor flags comment token ' + token + ' outside literals', () => {
    const result = auditSqlQuery(query);
    const finding = result.findings.find((item) => item.code === CODE.COMMENT_TOKEN);
    assert.equal(finding.token, token);
    assert.equal(finding.index, index);
    assert.equal(result.safe, false);
  });
}

const literalsWithCommentText = [
  "SELECT '--'",
  "SELECT '/*'",
  "SELECT '#'",
  'SELECT "--"',
  'SELECT "/*"',
  'SELECT `#`',
  'SELECT $$--$$',
  'SELECT $x$/*$x$',
  "SELECT 'it''s -- fine'",
  'SELECT "it""s /* fine */"'
];
for (const query of literalsWithCommentText) {
  test('auditor ignores comment-like text inside literals: ' + JSON.stringify(query), () => {
    const result = auditSqlQuery(query);
    assert.equal(result.safe, true);
    assert.equal(result.findings.some((finding) => finding.code === CODE.COMMENT_TOKEN), false);
  });
}

const dangerousCases = [
  ['DROP TABLE users', 'DROP'],
  ['drop table users', 'DROP'],
  ['TRUNCATE users', 'TRUNCATE'],
  ['ALTER TABLE users ADD x INT', 'ALTER'],
  ['GRANT SELECT ON users TO app', 'GRANT'],
  ['REVOKE SELECT ON users FROM app', 'REVOKE'],
  ['SELECT * INTO OUTFILE \'/tmp/x\' FROM users', 'INTO OUTFILE'],
  ['select * into outfile \'/tmp/x\' from users', 'INTO OUTFILE'],
  ['COPY users FROM PROGRAM \'cat /etc/passwd\'', 'COPY PROGRAM'],
  ['copy users from program \'x\'', 'COPY PROGRAM'],
  ['EXEC xp_cmdshell \'dir\'', 'XP_CMDSHELL'],
  ['xp_cmdshell \'dir\'', 'XP_CMDSHELL'],
  ['SELECT LOAD_FILE(\'/etc/passwd\')', 'LOAD_FILE'],
  ['ATTACH DATABASE \'x.db\' AS x', 'ATTACH DATABASE'],
  ['attach database \'x.db\' as x', 'ATTACH DATABASE'],
  ['BULK INSERT x FROM \'y\'', 'BULK INSERT']
];
for (const [query, token] of dangerousCases) {
  test('auditor detects dangerous keyword sequence: ' + token, () => {
    const result = auditSqlQuery(query);
    const finding = result.findings.find((item) => item.code === CODE.DANGEROUS_KEYWORD && item.token === token);
    assert.ok(finding, JSON.stringify(result.findings));
    assert.equal(result.safe, false);
  });
}

test('auditor does not treat dangerous words inside single quotes as keywords', () => {
  for (const query of ["SELECT 'DROP'", "SELECT 'TRUNCATE users'", "SELECT 'xp_cmdshell'", "SELECT 'INTO OUTFILE'"]) {
    assert.equal(hasCode(query, CODE.DANGEROUS_KEYWORD), false);
    assert.equal(auditSqlQuery(query).safe, true);
  }
});

test('auditor does not treat dangerous words inside quoted identifiers as keywords', () => {
  for (const query of ['SELECT "DROP" FROM t', 'SELECT `DROP` FROM t']) {
    assert.equal(hasCode(query, CODE.DANGEROUS_KEYWORD), false);
  }
});

test('auditor ignores dangerous words inside comments but still flags the comment token', () => {
  const result = auditSqlQuery('/* DROP TABLE users */ SELECT 1');
  assert.equal(hasCode('/* DROP TABLE users */ SELECT 1', CODE.DANGEROUS_KEYWORD), false);
  assert.equal(hasCode('/* DROP TABLE users */ SELECT 1', CODE.COMMENT_TOKEN), true);
});

test('COPY PROGRAM detection does not cross a statement boundary', () => {
  const query = 'COPY x FROM stdin; SELECT PROGRAM';
  assert.equal(hasCode(query, 'SQLCAGE_DANGEROUS_KEYWORD'), false);
  assert.equal(hasCode(query, CODE.MULTI_STATEMENT), true);
});

test('unterminated single quote is detected', () => {
  assert.equal(hasCode("SELECT 'abc", CODE.UNBALANCED_QUOTE), true);
});

test('unterminated double quote is detected', () => {
  assert.equal(hasCode('SELECT "abc', CODE.UNBALANCED_QUOTE), true);
});

test('unterminated backtick identifier is detected', () => {
  assert.equal(hasCode('SELECT `abc', CODE.UNBALANCED_QUOTE), true);
});

test('unterminated dollar quote is detected', () => {
  assert.equal(hasCode('SELECT $$abc', CODE.UNBALANCED_QUOTE), true);
});

test('unterminated tagged dollar quote is detected', () => {
  assert.equal(hasCode('SELECT $tag$abc', CODE.UNBALANCED_QUOTE), true);
});

test('unterminated block comment is detected', () => {
  const result = auditSqlQuery('SELECT 1 /* abc');
  assert.equal(hasCode('SELECT 1 /* abc', CODE.COMMENT_TOKEN), true);
  assert.equal(hasCode('SELECT 1 /* abc', CODE.UNBALANCED_QUOTE), true);
  assert.equal(result.findings.find((finding) => finding.code === CODE.UNBALANCED_QUOTE).token, '/*');
});

test('doubled single quotes balance correctly', () => {
  assert.equal(auditSqlQuery("SELECT 'it''s fine'").safe, true);
});

test('doubled double quotes balance correctly', () => {
  assert.equal(auditSqlQuery('SELECT "it""s fine"').safe, true);
});

test('doubled backticks balance correctly', () => {
  assert.equal(auditSqlQuery('SELECT `it``s`').safe, true);
});

test('mysql backslash escapes keep quote-like text inside strings', () => {
  assert.equal(auditSqlQuery("SELECT 'it\\'s -- fine'", { dialect: 'mysql' }).safe, true);
});

test('postgres mode does not treat a backslash as a string escape', () => {
  const query = "SELECT 'it\\' -- outside";
  assert.equal(hasCode(query, CODE.COMMENT_TOKEN, { dialect: 'postgres' }), true);
});

test('nested postgres-style block comments balance correctly', () => {
  const query = '/* outer /* inner */ still comment */ SELECT 1';
  assert.equal(hasCode(query, CODE.UNBALANCED_QUOTE), false);
  assert.equal(hasCode(query, CODE.COMMENT_TOKEN), true);
});

test('unbalanced nested block comment is detected', () => {
  assert.equal(hasCode('/* outer /* inner */ SELECT 1', CODE.UNBALANCED_QUOTE), true);
});

test('line comments end at newlines', () => {
  const query = 'SELECT 1 -- comment\nFROM users';
  const result = auditSqlQuery(query);
  assert.equal(result.stats.comments, 1);
  assert.equal(result.stats.statements, 1);
});

test('NUL bytes are detected anywhere including literals', () => {
  for (const query of ['SELECT \0 1', "SELECT '\0'", 'SELECT 1;\0SELECT 2', '\0']) {
    assert.equal(hasCode(query, CODE.NUL_BYTE), true);
    assert.equal(auditSqlQuery(query).safe, false);
  }
});


test('mysql backslash escapes cannot hide NUL bytes from the auditor', () => {
  const result = auditSqlQuery("SELECT '\\\0'", { dialect: 'mysql' });
  assert.equal(result.stats.nulBytes, 1);
  assert.equal(result.findings.some((finding) => finding.code === CODE.NUL_BYTE), true);
});

test('multiple NUL bytes produce one finding and count all bytes in stats', () => {
  const result = auditSqlQuery('SELECT \0\0\0');
  assert.equal(result.findings.filter((finding) => finding.code === CODE.NUL_BYTE).length, 1);
  assert.equal(result.stats.nulBytes, 3);
});

test('maximum SQL length is enforced', () => {
  const result = auditSqlQuery('x'.repeat(11), { maxSqlLength: 10 });
  assert.equal(result.safe, false);
  assert.equal(result.findings[0].code, CODE.MAX_SQL_LENGTH);
  assert.equal(result.findings[0].index, 10);
});

test('maximum SQL length exact boundary is clean', () => {
  assert.equal(auditSqlQuery('x'.repeat(10), { maxSqlLength: 10 }).safe, true);
});

test('audit input type is strict', () => {
  for (const input of [null, undefined, 1, {}, [], true, new String('SELECT 1')]) {
    assertThrowsCode(() => auditSqlQuery(input), CODE.INVALID_INPUT);
  }
});

test('audit options validate dialect and max length', () => {
  for (const options of [{ dialect: 'pg' }, { dialect: null }, { maxSqlLength: 0 }, { maxSqlLength: -1 }, { maxSqlLength: 1.5 }]) {
    assertThrowsCode(() => auditSqlQuery('SELECT 1', options), options.dialect !== undefined ? CODE.INVALID_DIALECT : CODE.INVALID_OPTIONS);
  }
});

test('audit result, findings array, findings, and stats are frozen', () => {
  const result = auditSqlQuery('SELECT 1; DROP TABLE x\0');
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.findings), true);
  assert.equal(Object.isFrozen(result.stats), true);
  for (const finding of result.findings) assert.equal(Object.isFrozen(finding), true);
});

test('audit stats count length, UTF-8 bytes, semicolons, statements, comments, and keywords', () => {
  const query = 'SELECT \'é\'; DROP TABLE x; SELECT 2 -- x';
  const result = auditSqlQuery(query);
  assert.equal(result.stats.length, query.length);
  assert.equal(result.stats.bytes, Buffer.byteLength(query, 'utf8'));
  assert.equal(result.stats.semicolons, 2);
  assert.equal(result.stats.statements, 3);
  assert.equal(result.stats.comments, 1);
  assert.equal(result.stats.dangerousKeywords, 1);
});

test('audit findings carry stable index positions', () => {
  const query = 'SELECT 1; DROP TABLE x';
  const result = auditSqlQuery(query);
  const multi = result.findings.find((finding) => finding.code === CODE.MULTI_STATEMENT);
  const dangerous = result.findings.find((finding) => finding.code === CODE.DANGEROUS_KEYWORD);
  assert.equal(multi.index, 10);
  assert.equal(dangerous.index, 10);
});

test('empty SQL is safe but has zero statements', () => {
  const result = auditSqlQuery('');
  assert.equal(result.safe, true);
  assert.equal(result.stats.statements, 0);
});

test('whitespace-only SQL is safe but has zero statements', () => {
  const result = auditSqlQuery(' \t\r\n');
  assert.equal(result.safe, true);
  assert.equal(result.stats.statements, 0);
});

test('comment-only SQL has zero executable statements but is unsafe under strict audit policy', () => {
  const result = auditSqlQuery('-- only a comment');
  assert.equal(result.safe, false);
  assert.equal(result.stats.statements, 0);
  assert.equal(result.findings[0].code, CODE.COMMENT_TOKEN);
});

test('a semicolon before a comment does not count the comment as executable SQL', () => {
  const result = auditSqlQuery('; -- comment');
  assert.equal(result.stats.statements, 0);
  assert.equal(hasCode('; -- comment', CODE.MULTI_STATEMENT), false);
});

test('mysql parameters and hash comments do not confuse lexical states', () => {
  const result = auditSqlQuery('SELECT ? WHERE x = ? # mysql comment', { dialect: 'mysql' });
  assert.equal(result.stats.statements, 1);
  assert.equal(result.safe, false);
});

test('postgres dollar positional parameters are not treated as dollar quotes', () => {
  const result = auditSqlQuery('SELECT * FROM users WHERE id = $1 AND x = $22', { dialect: 'postgres' });
  assert.equal(result.safe, true);
});

test('dollar quote tags cannot start with digits', () => {
  const result = auditSqlQuery('SELECT $1$ DROP TABLE x $1$', { dialect: 'postgres' });
  assert.equal(hasCode('SELECT $1$ DROP TABLE x $1$', CODE.DANGEROUS_KEYWORD, { dialect: 'postgres' }), true);
  assert.equal(result.safe, false);
});

test('many findings are capped without unbounded memory growth', () => {
  const query = Array.from({ length: 300 }, (_, index) => 'DROP t' + index).join('; ');
  const result = auditSqlQuery(query);
  assert.equal(result.findings.length, 256);
  assert.ok(result.stats.truncatedFindings > 0);
  assert.equal(result.safe, false);
});
