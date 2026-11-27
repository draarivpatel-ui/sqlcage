import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CODE,
  auditSqlQuery,
  compileQuery,
  createSchemaGuard,
  createSqlCage,
  escapeLikePattern,
  isSqlFragment,
  isValidIdentifier,
  quoteIdentifier,
  safeColumns,
  safeLimitOffset,
  safeOrderBy,
  sql,
  sqlIn,
  sqlJoin,
  sqlLike,
  sqlSet,
  sqlValues
} from '../src/index.mjs';
import { assertThrowsCode, pg, textOf } from './test-utils.mjs';

test('fragments cannot be mutated after creation', () => {
  const fragment = sql`SELECT ${1}`;
  assert.throws(() => { fragment.extra = true; }, TypeError);
  const symbols = Object.getOwnPropertySymbols(fragment);
  assert.throws(() => { fragment[symbols[0]] = false; }, TypeError);
  assert.equal(isSqlFragment(fragment), true);
});

test('compiled output does not expose the internal fragment data structure', () => {
  const result = compileQuery(sql`SELECT ${1}`);
  assert.deepEqual(Object.keys(result).sort(), ['text', 'values']);
  assert.equal('strings' in result, false);
});

test('compileQuery rejects template arrays even when frozen', () => {
  const strings = ['SELECT '];
  strings.raw = Object.freeze(['SELECT ']);
  Object.freeze(strings);
  assertThrowsCode(() => compileQuery(strings), CODE.INVALID_FRAGMENT);
});

test('compile preserves whitespace and punctuation exactly', () => {
  const source = '  SELECT\t*\n    FROM users  --x';
  assert.equal(compileQuery(sql`  SELECT\t*
    FROM users  --x`).text, source);
});

test('cooked template text is used rather than raw template text', () => {
  const result = compileQuery(sql`SELECT '\n'`);
  assert.equal(result.text, 'SELECT \'\n\'');
});

for (const length of [1, 2, 62, 63]) {
  test('identifier length boundary accepted at ' + length, () => {
    const identifier = 'a'.repeat(length);
    assert.equal(isValidIdentifier(identifier), true);
    assert.equal(quoteIdentifier(identifier), '"' + identifier + '"');
  });
}

for (const length of [64, 65, 128]) {
  test('identifier length boundary rejected at ' + length, () => {
    assert.equal(isValidIdentifier('a'.repeat(length)), false);
  });
}

for (const name of ['__proto__', 'constructor', 'prototype']) {
  test('JSON-carried prototype-pollution identifier is rejected for ' + name, () => {
    const parsed = JSON.parse('{"' + name + '": ["id"]}');
    assertThrowsCode(() => createSchemaGuard(parsed), CODE.INVALID_IDENTIFIER);
    assertThrowsCode(() => safeColumns([name], [name]), CODE.INVALID_IDENTIFIER);
    assertThrowsCode(() => safeOrderBy(name + ':asc', [name]), CODE.INVALID_IDENTIFIER);
  });
}

for (const separator of [',', ', ', ' , ', ' OR ', ' and ']) {
  test('sqlJoin accepts constrained safe separator ' + JSON.stringify(separator), () => {
    const fragment = sqlJoin([sql`a`, sql`b`], separator);
    assert.equal(isSqlFragment(fragment), true);
  });
}

for (const separator of [' UNION ', 'SELECT', 'OR 1=1', 'AND--', 'AND; ', 'AND /*x*/ ', 'AND`', 'AND"', 'AND#', '\tAND\t', '\nOR\n']) {
  test('sqlJoin rejects structurally unsafe separator ' + JSON.stringify(separator), () => {
    assertThrowsCode(() => sqlJoin([sql`a`, sql`b`], separator), CODE.INVALID_JOIN_SEPARATOR);
  });
}

test('sqlJoin separators are not uppercased or rewritten', () => {
  assert.equal(textOf(sql`${sqlJoin([sql`a`, sql`b`], ' and ')}`), 'a and b');
});

test('sqlIn one-item list has no trailing comma', () => {
  assert.equal(textOf(sql`WHERE id ${sqlIn([1])}`), 'WHERE id IN ($1)');
});

test('sqlIn parameter order remains stable when nested in another fragment', () => {
  const result = pg(sql`WHERE a = ${0} AND id ${sqlIn([1, 2])} AND z = ${3}`);
  assert.equal(result.text, 'WHERE a = $1 AND id IN ($2, $3) AND z = $4');
  assert.deepEqual(result.values, [0, 1, 2, 3]);
});

for (const count of [1, 2, 10, 100]) {
  test('sqlIn compiles ' + count + ' items into the same number of placeholders', () => {
    const values = Array.from({ length: count }, (_, index) => index);
    const result = pg(sql`${sqlIn(values)}`);
    assert.equal((result.text.match(/\$/g) || []).length, count);
    assert.equal(result.values.length, count);
  });
}

test('sqlValues object mode rejects columns in explicit list that are missing from rows', () => {
  assertThrowsCode(() => sqlValues([{ id: 1 }], { columns: ['id', 'name'] }), CODE.EMPTY_VALUES);
});

test('sqlValues object mode accepts null prototype rows', () => {
  const row = Object.create(null);
  row.id = 1;
  row.name = 'a';
  const result = pg(sql`${sqlValues([row])}`);
  assert.deepEqual(result.values, [1, 'a']);
});

test('sqlValues rejects null prototype rows with unexpected keys', () => {
  const row = Object.create(null);
  row.id = 1;
  row.extra = 2;
  assertThrowsCode(() => sqlValues([row], { columns: ['id'] }), CODE.EMPTY_VALUES);
});

test('sqlSet accepts null prototype assignment objects', () => {
  const assignments = Object.create(null);
  assignments.name = 'x';
  const result = pg(sql`${sqlSet(assignments)}`);
  assert.equal(result.text, 'SET "name" = $1');
});

test('sqlSet preserves insertion order for deterministic compilation', () => {
  const result = pg(sql`${sqlSet({ zed: 1, alpha: 2, middle: 3 })}`);
  assert.equal(result.text, 'SET "zed" = $1, "alpha" = $2, "middle" = $3');
  assert.deepEqual(result.values, [1, 2, 3]);
});

for (const value of ['%', '_', '\\', '%%__\\\\', 'a%b_c\\d']) {
  test('LIKE escaping is reversible in shape for ' + JSON.stringify(value), () => {
    const escaped = escapeLikePattern(value).pattern;
    assert.equal(escaped.length >= value.length, true);
    const unescaped = escaped.replace(/\\([%_\\])/g, '$1');
    assert.equal(unescaped, value);
  });
}

test('sqlLike empty search string is allowed and mode controlled', () => {
  assert.deepEqual(pg(sql`${sqlLike('name', '', { mode: 'contains' })}`).values, ['%%']);
  assert.deepEqual(pg(sql`${sqlLike('name', '', { mode: 'startsWith' })}`).values, ['%']);
  assert.deepEqual(pg(sql`${sqlLike('name', '', { mode: 'endsWith' })}`).values, ['%']);
});

test('sqlLike custom escape character appears literally once in postgres output', () => {
  const result = pg(sql`${sqlLike('name', 'a%b', { escapeChar: '!' })}`);
  assert.equal(result.text, '"name" LIKE $1 ESCAPE \'!\'');
  assert.deepEqual(result.values, ['%a!%b%']);
});

test('sqlLike mysql output doubles a backslash escape literal', () => {
  const result = compileQuery(sql`${sqlLike('name', 'x', { dialect: 'mysql' })}`, { dialect: 'mysql' });
  assert.equal(result.sql.includes("ESCAPE '\\\\'"), true);
});

test('safeOrderBy nulls string syntax is parsed explicitly', () => {
  assert.equal(textOf(sql`${safeOrderBy('id:desc:nulls-last', ['id'])}`), 'ORDER BY "id" DESC NULLS LAST');
  assert.equal(textOf(sql`${safeOrderBy('id:asc:nulls-first', ['id'])}`), 'ORDER BY "id" ASC NULLS FIRST');
});

test('safeOrderBy rejects ambiguous extra string segments', () => {
  for (const input of ['id:asc:first:extra', 'id::nulls-last', 'id:asc:', 'id:nulls-last']) {
    assertThrowsCode(() => safeOrderBy(input, ['id']), CODE.INVALID_ORDER_BY);
  }
});

test('safeColumns is case-sensitive because SQL identifiers are case-sensitive when quoted', () => {
  assertThrowsCode(() => safeColumns(['ID'], ['id']), CODE.UNKNOWN_COLUMN);
  assert.equal(textOf(sql`${safeColumns(['id'], ['id'])}`), '"id"');
});

test('schema guard lookups are case-sensitive', () => {
  const guard = createSchemaGuard({ users: ['id'] });
  assertThrowsCode(() => guard.table('Users'), CODE.UNKNOWN_TABLE);
  assertThrowsCode(() => guard.column('users', 'ID'), CODE.UNKNOWN_COLUMN);
});

test('schema guard maxColumns also constrains schema width at construction time', () => {
  assertThrowsCode(() => createSchemaGuard({ users: ['id', 'email'] }, { maxColumns: 1 }), CODE.INVALID_SCHEMA);
  const guard = createSchemaGuard({ users: ['id', 'email'] }, { maxColumns: 2 });
  assert.equal(textOf(sql`${guard.columns('users', ['id', 'email'])}`), '"users"."id", "users"."email"');
});

test('schema options can narrow pagination maxLimit', () => {
  const guard = createSchemaGuard({ users: ['id'] }, { maxLimit: 5 });
  assertThrowsCode(() => guard.limitOffset({ limit: 6 }), CODE.INVALID_LIMIT_OFFSET);
  assert.equal(isSqlFragment(guard.limitOffset({ limit: 5 })), true);
});

test('safeLimitOffset input maxLimit overrides the default policy', () => {
  assert.equal(isSqlFragment(safeLimitOffset({ limit: 1500, maxLimit: 1500 })), true);
  assertThrowsCode(() => safeLimitOffset({ limit: 1001 }), CODE.INVALID_LIMIT_OFFSET);
});




test('pagination values must be own properties rather than prototype pollution', () => {
  const input = {};
  Object.setPrototypeOf(input, { limit: 5, maxLimit: 100 });
  assertThrowsCode(() => safeLimitOffset(input), CODE.INVALID_LIMIT_OFFSET);
});

test('schema table columns must be own properties rather than prototype pollution', () => {
  const tableSpec = {};
  Object.setPrototypeOf(tableSpec, { columns: ['id'] });
  assertThrowsCode(() => createSchemaGuard({ users: tableSpec }), CODE.INVALID_SCHEMA);
});

test('schema guard options are captured rather than mutated later', () => {
  const options = { maxLimit: 5, maxClauses: 1 };
  const guard = createSchemaGuard({ users: ['id'] }, options);
  options.maxLimit = 100;
  options.maxClauses = 10;
  assertThrowsCode(() => guard.limitOffset({ limit: 6 }), CODE.INVALID_LIMIT_OFFSET);
  assertThrowsCode(() => guard.limitOffset({ limit: 6, maxLimit: 100 }), CODE.INVALID_LIMIT_OFFSET);
  assert.equal(isSqlFragment(guard.limitOffset({ limit: 5 })), true);
});

test('createSqlCage compile inherits parameter policy', () => {
  const cage = createSqlCage({ maxParameters: 1 });
  assertThrowsCode(() => cage.compile(cage.sql`SELECT ${1}, ${2}`), CODE.MAX_PARAMETERS);
});

test('createSqlCage compile can narrow but not remove base validation', () => {
  const cage = createSqlCage({ allowObjects: false });
  assertThrowsCode(() => cage.compile(cage.sql`SELECT ${{ a: 1 }}`), CODE.INVALID_PARAMETER);
});

test('createSqlCage compile explicit allowObjects permits objects', () => {
  const cage = createSqlCage();
  const value = { a: 1 };
  assert.equal(cage.compile(cage.sql`SELECT ${value}`, { allowObjects: true }).values[0], value);
});

test('compile output placeholders do not become confused after parameter nine', () => {
  const parts = Array.from({ length: 12 }, (_, index) => sql`${index}`);
  const result = pg(sql`${sqlJoin(parts, ', ')}`);
  assert.equal(result.text, '$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12');
});


test('undefined compile overrides do not erase narrowed createSqlCage policy', () => {
  const cage = createSqlCage({ maxParameters: 1 });
  assertThrowsCode(() => cage.compile(cage.sql`SELECT ${1}, ${2}`, { maxParameters: undefined }), CODE.MAX_PARAMETERS);
});

test('audit treats CRLF as whitespace rather than a SQL token', () => {
  const result = auditSqlQuery('SELECT 1;\r\nSELECT 2');
  assert.equal(result.safe, false);
  assert.equal(result.stats.statements, 2);
});

test('audit line comment ends at CRLF boundary', () => {
  const result = auditSqlQuery('SELECT 1 -- x\r\nFROM users');
  assert.equal(result.stats.statements, 1);
});

test('audit does not mistake type casts or JSON operators for comments', () => {
  const result = auditSqlQuery("SELECT data::text, meta #>> '{a}' FROM t");
  assert.equal(result.findings.some((finding) => finding.token === '#'), true);
});

test('audit strictness intentionally flags hash even when it is an operator in some dialects', () => {
  assert.equal(auditSqlQuery('SELECT a # b').safe, false);
});

test('audit keyword scanner is case-insensitive', () => {
  for (const query of ['drop table x', 'DrOp TaBlE x', 'alter table x', 'gRaNt x to y']) {
    assert.equal(auditSqlQuery(query).safe, false);
  }
});

test('audit keyword scanner requires word boundaries', () => {
  for (const query of ['SELECT droplet FROM x', 'SELECT alteration FROM x', 'SELECT granted FROM x']) {
    assert.equal(auditSqlQuery(query).safe, true);
  }
});

test('audit catches dangerous keyword after a leading empty statement', () => {
  const result = auditSqlQuery('; DROP TABLE x');
  assert.equal(result.findings.some((finding) => finding.code === CODE.MULTI_STATEMENT), true);
  assert.equal(result.findings.some((finding) => finding.code === CODE.DANGEROUS_KEYWORD), true);
});

test('audit max length still scans enough input to preserve lexical findings', () => {
  const result = auditSqlQuery('SELECT 1; DROP ' + 'x'.repeat(100), { maxSqlLength: 10 });
  assert.equal(result.findings.some((finding) => finding.code === CODE.MAX_SQL_LENGTH), true);
  assert.equal(result.findings.some((finding) => finding.code === CODE.DANGEROUS_KEYWORD), true);
});

test('audit invalid max lengths fail before scanning', () => {
  for (const maxSqlLength of [0, -1, 1.5, '10', NaN, Infinity]) {
    assertThrowsCode(() => auditSqlQuery('SELECT 1', { maxSqlLength }), CODE.INVALID_OPTIONS);
  }
});

test('helper fragments compile under default depth budget when composed broadly', () => {
  const conditions = [];
  for (let index = 0; index < 100; index += 1) conditions.push(sql`c = ${index}`);
  const fragment = sql`WHERE ${sqlJoin(conditions, ' AND ')}`;
  const result = pg(fragment);
  assert.equal(result.values.length, 100);
});

test('numeric column suffixes in generated SQL are text, not identifiers', () => {
  const conditions = [sql`c0 = ${0}`, sql`c1 = ${1}`];
  const result = pg(sql`WHERE ${sqlJoin(conditions, ' AND ')}`);
  assert.equal(result.text, 'WHERE c0 = $1 AND c1 = $2');
});
