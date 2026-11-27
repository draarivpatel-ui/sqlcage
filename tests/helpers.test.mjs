import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CODE,
  createSchemaGuard,
  escapeLikePattern,
  isSqlFragment,
  sql,
  sqlAnd,
  sqlIn,
  sqlJoin,
  sqlLike,
  sqlOr,
  sqlSet,
  sqlValues
} from '../src/index.mjs';
import { assertThrowsCode, lite, my, pg, textOf } from './test-utils.mjs';

test('sqlJoin joins fragments with a comma by default', () => {
  const result = pg(sql`SELECT ${sqlJoin([sql`a = ${1}`, sql`b = ${2}`])}`);
  assert.equal(result.text, 'SELECT a = $1, b = $2');
  assert.deepEqual(result.values, [1, 2]);
});

test('sqlJoin supports safe custom separators', () => {
  const result = pg(sql`${sqlJoin([sql`x`, sql`y`, sql`z`], ' OR ')}`);
  assert.equal(result.text, 'x OR y OR z');
});

test('sqlJoin returns an empty fragment for an empty array', () => {
  assert.equal(textOf(sql`a${sqlJoin([], ', ')}b`), 'ab');
});

test('sqlJoin rejects non-fragment items including strings', () => {
  for (const item of ['OR 1=1', 1, null, {}, [], undefined]) {
    assertThrowsCode(() => sqlJoin([item]), CODE.INVALID_FRAGMENT);
  }
});

test('sqlJoin rejects non-array input', () => {
  for (const input of [null, undefined, 'a,b', {}, 1]) {
    assertThrowsCode(() => sqlJoin(input), CODE.INVALID_INPUT);
  }
});

test('sqlJoin rejects separators that can alter SQL structure', () => {
  for (const separator of [';', '--', '/*', '*/', "'", '"', '`', '#', ' UNION ', ' SELECT ', ' | ', 'x\0y', 'x\n', 'x'.repeat(33), '']) {
    assertThrowsCode(() => sqlJoin([sql`a`, sql`b`], separator), CODE.INVALID_JOIN_SEPARATOR);
  }
});

test('sqlAnd wraps and joins every condition', () => {
  const result = pg(sql`WHERE ${sqlAnd([sql`a = ${1}`, sql`b = ${2}`, sql`c = ${3}`])}`);
  assert.equal(result.text, 'WHERE (a = $1) AND (b = $2) AND (c = $3)');
  assert.deepEqual(result.values, [1, 2, 3]);
});

test('sqlOr wraps and joins every condition', () => {
  const result = pg(sql`WHERE ${sqlOr([sql`a = ${1}`, sql`b = ${2}`])}`);
  assert.equal(result.text, 'WHERE (a = $1) OR (b = $2)');
});

test('sqlAnd and sqlOr reject empty lists', () => {
  assertThrowsCode(() => sqlAnd([]), CODE.EMPTY_CONDITION_LIST);
  assertThrowsCode(() => sqlOr([]), CODE.EMPTY_CONDITION_LIST);
});

test('sqlAnd and sqlOr reject raw string conditions', () => {
  assertThrowsCode(() => sqlAnd(['a=1']), CODE.INVALID_FRAGMENT);
  assertThrowsCode(() => sqlOr(['a=1']), CODE.INVALID_FRAGMENT);
});

test('sqlAnd and sqlOr compose nested boolean logic in parameter order', () => {
  const either = sqlOr([sql`b = ${2}`, sql`c = ${3}`]);
  const result = pg(sql`WHERE ${sqlAnd([sql`a = ${1}`, either, sql`d = ${4}`])}`);
  assert.equal(result.text, 'WHERE (a = $1) AND ((b = $2) OR (c = $3)) AND (d = $4)');
  assert.deepEqual(result.values, [1, 2, 3, 4]);
});

test('sqlIn emits a parenthesized parameterized IN list', () => {
  const result = pg(sql`WHERE id ${sqlIn([1, 2, 3])}`);
  assert.equal(result.text, 'WHERE id IN ($1, $2, $3)');
  assert.deepEqual(result.values, [1, 2, 3]);
});

test('sqlIn binds strings instead of concatenating them', () => {
  const hostile = "x') OR ('1'='1";
  const result = pg(sql`WHERE name ${sqlIn([hostile])}`);
  assert.equal(result.text, 'WHERE name IN ($1)');
  assert.deepEqual(result.values, [hostile]);
});

test('sqlIn supports mysql placeholders', () => {
  const result = my(sql`WHERE id ${sqlIn([1, 'x'])}`);
  assert.equal(result.sql, 'WHERE id IN (?, ?)');
  assert.deepEqual(result.values, [1, 'x']);
});

test('sqlIn supports sqlite placeholders', () => {
  const result = lite(sql`WHERE id ${sqlIn([1, 'x'])}`);
  assert.equal(result.sql, 'WHERE id IN (?, ?)');
  assert.deepEqual(result.params, [1, 'x']);
});

test('sqlIn rejects an empty array by default', () => {
  assertThrowsCode(() => sqlIn([]), CODE.EMPTY_IN_LIST);
});

test('sqlIn empty false mode remains syntactically valid after IN', () => {
  const result = pg(sql`WHERE id ${sqlIn([], { onEmpty: 'false' })}`);
  assert.equal(result.text, 'WHERE id IN (SELECT NULL WHERE 1 = 0)');
  assert.deepEqual(result.values, []);
});

test('sqlIn column form emits a complete false predicate for empty input', () => {
  const result = pg(sql`WHERE ${sqlIn('id', [], { onEmpty: 'false' })}`);
  assert.equal(result.text, 'WHERE 1 = 0');
});

test('sqlIn column form quotes identifiers per dialect', () => {
  assert.equal(my(sql`WHERE ${sqlIn('id', [1], { dialect: 'mysql' })}`).sql, 'WHERE `id` IN (?)');
  assert.equal(lite(sql`WHERE ${sqlIn('id', [1], { dialect: 'sqlite' })}`).sql, 'WHERE "id" IN (?)');
});

test('sqlIn column form accepts schema guard fragments', () => {
  const guard = createSchemaGuard({ users: ['id'] });
  const result = pg(sql`WHERE ${sqlIn(guard.column('users', 'id'), [1, 2])}`);
  assert.equal(result.text, 'WHERE "users"."id" IN ($1, $2)');
});

test('sqlIn rejects malformed column identifiers', () => {
  for (const column of ['id;DROP', 'id OR 1=1', 1, null, {}]) {
    assertThrowsCode(() => sqlIn(column, [1]), CODE.INVALID_IDENTIFIER);
  }
});

test('sqlIn enforces its parameter cap at construction time', () => {
  assert.equal(isSqlFragment(sqlIn([1, 2], { maxParameters: 2 })), true);
  assertThrowsCode(() => sqlIn([1, 2, 3], { maxParameters: 2 }), CODE.MAX_PARAMETERS);
});

test('sqlIn rejects invalid onEmpty modes', () => {
  for (const mode of ['true', 'null', 'throw ', 1, false]) {
    assertThrowsCode(() => sqlIn([], { onEmpty: mode }), CODE.INVALID_OPTIONS);
  }
});

test('sqlIn rejects non-array values and options', () => {
  for (const input of [null, undefined, '1,2', {}, 1]) {
    assertThrowsCode(() => sqlIn(input), CODE.INVALID_INPUT);
  }
  assertThrowsCode(() => sqlIn([1], null), CODE.INVALID_OPTIONS);
});

test('sqlIn can contain nested fragments without treating them as parameters', () => {
  const result = pg(sql`WHERE x ${sqlIn([sql`lower(${ 'AB' })`, 'bc'])}`);
  assert.equal(result.text, 'WHERE x IN (lower($1), $2)');
  assert.deepEqual(result.values, ['AB', 'bc']);
});

test('sqlValues emits multi-row parameterized VALUES arrays', () => {
  const result = pg(sql`INSERT INTO users (id, name) ${sqlValues([[1, 'a'], [2, 'b'], [3, 'c']])}`);
  assert.equal(result.text, 'INSERT INTO users (id, name) VALUES ($1, $2), ($3, $4), ($5, $6)');
  assert.deepEqual(result.values, [1, 'a', 2, 'b', 3, 'c']);
});

test('sqlValues binds hostile strings instead of concatenating them', () => {
  const hostile = "x'), ('1','1";
  const result = pg(sql`${sqlValues([[hostile]])}`);
  assert.equal(result.text, 'VALUES ($1)');
  assert.deepEqual(result.values, [hostile]);
});

test('sqlValues supports object rows with deterministic explicit columns', () => {
  const rows = [
    { id: 1, name: 'a' },
    { id: 2, name: 'b' }
  ];
  const result = pg(sql`${sqlValues(rows, { columns: ['id', 'name'] })}`);
  assert.equal(result.text, 'VALUES ($1, $2), ($3, $4)');
  assert.deepEqual(result.values, [1, 'a', 2, 'b']);
});

test('sqlValues derives object row columns from the first row', () => {
  const result = pg(sql`${sqlValues([{ id: 1, name: 'a' }])}`);
  assert.equal(result.text, 'VALUES ($1, $2)');
  assert.deepEqual(result.values, [1, 'a']);
});

test('sqlValues rejects empty rows input', () => {
  assertThrowsCode(() => sqlValues([]), CODE.EMPTY_VALUES);
  assertThrowsCode(() => sqlValues(null), CODE.EMPTY_VALUES);
});

test('sqlValues rejects empty or ragged array rows', () => {
  for (const rows of [[[ ]], [[1], []], [[1], [1, 2]], [[1], 'x']]) {
    assertThrowsCode(() => sqlValues(rows), CODE.EMPTY_VALUES);
  }
});

test('sqlValues rejects object rows with missing or extra keys', () => {
  assertThrowsCode(() => sqlValues([{ id: 1, name: 'a' }, { id: 2 }]), CODE.EMPTY_VALUES);
  assertThrowsCode(() => sqlValues([{ id: 1, name: 'a' }, { id: 2, name: 'b', extra: 3 }]), CODE.EMPTY_VALUES);
});

test('sqlValues validates object column names even though values are bound', () => {
  assertThrowsCode(() => sqlValues([{ id: 1 }], { columns: ['id;DROP'] }), CODE.INVALID_IDENTIFIER);
});

test('sqlValues enforces parameter count at construction time', () => {
  assertThrowsCode(() => sqlValues([[1, 2], [3, 4]], { maxParameters: 3 }), CODE.MAX_PARAMETERS);
  assert.equal(isSqlFragment(sqlValues([[1, 2], [3, 4]], { maxParameters: 4 })), true);
});

test('sqlValues enforces maxRows at construction time', () => {
  assertThrowsCode(() => sqlValues([[1], [2]], { maxRows: 1 }), CODE.EMPTY_VALUES);
});

test('sqlSet emits validated assignment identifiers and binds values', () => {
  const result = pg(sql`UPDATE users ${sqlSet({ name: "x'; DROP TABLE users; --", age: 4 })} WHERE id = ${1}`);
  assert.equal(result.text, 'UPDATE users SET "name" = $1, "age" = $2 WHERE id = $3');
  assert.deepEqual(result.values, ["x'; DROP TABLE users; --", 4, 1]);
});

test('sqlSet quotes identifiers for mysql and sqlite', () => {
  assert.equal(my(sql`${sqlSet({ display_name: 'x' }, { dialect: 'mysql' })}`).sql, 'SET `display_name` = ?');
  assert.equal(lite(sql`${sqlSet({ display_name: 'x' }, { dialect: 'sqlite' })}`).sql, 'SET "display_name" = ?');
});

test('sqlSet enforces an optional column allowlist', () => {
  assert.equal(isSqlFragment(sqlSet({ name: 'x' }, { allowedColumns: ['name'] })), true);
  assertThrowsCode(() => sqlSet({ password_hash: 'x' }, { allowedColumns: ['name'] }), CODE.UNKNOWN_COLUMN);
});

test('sqlSet rejects invalid identifiers and prototype-pollution keys', () => {
  for (const key of ['bad name', 'x;DROP', '__proto__', 'constructor', 'prototype']) {
    const assignments = JSON.parse('{"' + key.replace(/"/g, '\\"') + '":1}');
    assertThrowsCode(() => sqlSet(assignments), CODE.INVALID_IDENTIFIER);
  }
});

test('sqlSet rejects empty and malformed assignment objects', () => {
  for (const input of [{}, null, undefined, [], 'name=1', 1]) {
    assertThrowsCode(() => sqlSet(input), CODE.EMPTY_SET);
  }
});

test('sqlSet enforces maxColumns', () => {
  assertThrowsCode(() => sqlSet({ a: 1, b: 2 }, { maxColumns: 1 }), CODE.EMPTY_SET);
});

test('escapeLikePattern escapes percent, underscore, and the escape character', () => {
  assert.deepEqual(escapeLikePattern('100%_\\x'), { pattern: '100\\%\\_\\\\x', escapeChar: '\\' });
});

test('escapeLikePattern leaves ordinary text unchanged', () => {
  assert.deepEqual(escapeLikePattern('plain text 123'), { pattern: 'plain text 123', escapeChar: '\\' });
});

test('escapeLikePattern supports safe alternate escape characters', () => {
  for (const escapeChar of ['!', '@', '#', '^', '~', '|']) {
    const result = escapeLikePattern('a%b_c' + escapeChar, escapeChar);
    assert.equal(result.pattern, 'a' + escapeChar + '%b' + escapeChar + '_c' + escapeChar + escapeChar);
    assert.equal(result.escapeChar, escapeChar);
    assert.equal(Object.isFrozen(result), true);
  }
});

test('escapeLikePattern rejects unsafe escape characters', () => {
  for (const escapeChar of ['', "'", '"', '`', ';', '-', '/', '%', '_', 'aa', 'é', 1, null]) {
    assertThrowsCode(() => escapeLikePattern('x', escapeChar), CODE.INVALID_LIKE_PATTERN);
  }
});

test('escapeLikePattern rejects non-string input', () => {
  for (const input of [null, undefined, 1, {}, [], true]) {
    assertThrowsCode(() => escapeLikePattern(input), CODE.INVALID_LIKE_PATTERN);
  }
});

test('sqlLike contains mode escapes wildcards and binds the pattern', () => {
  const result = pg(sql`SELECT * FROM users WHERE ${sqlLike('name', '100%_')}`);
  assert.equal(result.text, 'SELECT * FROM users WHERE "name" LIKE $1 ESCAPE \'\\\'');
  assert.deepEqual(result.values, ['%100\\%\\_%']);
});

test('sqlLike startsWith mode only suffixes an intentional wildcard', () => {
  assert.deepEqual(pg(sql`${sqlLike('name', 'a%')}`, { mode: undefined }).values, ['%a\\%%']);
  assert.deepEqual(pg(sql`${sqlLike('name', 'a%', { mode: 'startsWith' })}`).values, ['a\\%%']);
});

test('sqlLike endsWith mode only prefixes an intentional wildcard', () => {
  assert.deepEqual(pg(sql`${sqlLike('name', 'a_', { mode: 'endsWith' })}`).values, ['%a\\_']);
});

test('sqlLike supports schema guard column fragments', () => {
  const guard = createSchemaGuard({ users: ['name'] });
  const result = pg(sql`${sqlLike(guard.column('users', 'name'), 'x')}`);
  assert.equal(result.text, '"users"."name" LIKE $1 ESCAPE \'\\\'');
});

test('sqlLike quotes a string column per dialect', () => {
  const mysqlSql = my(sql`${sqlLike('name', 'x', { dialect: 'mysql' })}`).sql;
  assert.equal(mysqlSql, '`name` LIKE ? ESCAPE \'!\'');
  assert.equal(lite(sql`${sqlLike('name', 'x', { dialect: 'sqlite' })}`).sql, '"name" LIKE ? ESCAPE \'\\\'');
});

test('sqlLike rejects invalid columns and modes', () => {
  assertThrowsCode(() => sqlLike('name;DROP', 'x'), CODE.INVALID_IDENTIFIER);
  assertThrowsCode(() => sqlLike(1, 'x'), CODE.INVALID_IDENTIFIER);
  assertThrowsCode(() => sqlLike('name', 'x', { mode: 'everywhere' }), CODE.INVALID_LIKE_PATTERN);
});

test('sqlLike rejects non-string values', () => {
  for (const value of [null, undefined, 1, {}, [], false]) {
    assertThrowsCode(() => sqlLike('name', value), CODE.INVALID_LIKE_PATTERN);
  }
});

test('sqlLike enforces maxPatternLength', () => {
  assert.equal(isSqlFragment(sqlLike('name', 'xx', { maxPatternLength: 2 })), true);
  assertThrowsCode(() => sqlLike('name', 'xxx', { maxPatternLength: 2 }), CODE.INVALID_LIKE_PATTERN);
});

test('helpers compose in a realistic safe query', () => {
  const guard = createSchemaGuard({
    users: { columns: ['id', 'name', 'email', 'created_at'], sortable: ['created_at', 'id'] }
  });
  const result = pg(sql`SELECT ${guard.columns('users', ['id', 'name', 'email'])}
FROM ${guard.table('users')}
WHERE ${sqlAnd([
  sqlIn(guard.column('users', 'id'), [10, 11, 12]),
  sqlLike(guard.column('users', 'name'), 'a%z', { mode: 'contains' }),
  sql`${guard.column('users', 'created_at')} > ${'2026-01-01'}`
])}
${guard.orderBy('users', 'created_at:desc')}
${guard.limitOffset({ limit: 25 })}`);
  assert.equal(result.text, 'SELECT "users"."id", "users"."name", "users"."email"\nFROM "users"\nWHERE ("users"."id" IN ($1, $2, $3)) AND ("users"."name" LIKE $4 ESCAPE \'\\\') AND ("users"."created_at" > $5)\nORDER BY "users"."created_at" DESC\nLIMIT $6 OFFSET $7');
  assert.deepEqual(result.values, [10, 11, 12, '%a\\%z%', '2026-01-01', 25, 0]);
});
