import test from 'node:test';
import assert from 'node:assert/strict';
import sqlcage, {
  CODE,
  SqlCageError,
  compileQuery,
  createSqlCage,
  isSqlFragment,
  sql,
  sqlJoin
} from '../src/index.mjs';
import { assertThrowsCode, lite, my, pg, textOf } from './test-utils.mjs';

test('sql returns an opaque frozen branded fragment', () => {
  const fragment = sql`SELECT ${1}`;
  assert.equal(isSqlFragment(fragment), true);
  assert.equal(Object.isFrozen(fragment), true);
  assert.deepEqual(Object.keys(fragment), []);
  assert.equal(Object.getPrototypeOf(fragment), null);
});

test('sql fragment symbol brand is non-enumerable', () => {
  const fragment = sql`SELECT 1`;
  const symbols = Object.getOwnPropertySymbols(fragment);
  assert.equal(symbols.length, 1);
  assert.equal(Object.getOwnPropertyDescriptor(fragment, symbols[0]).enumerable, false);
});

test('isSqlFragment rejects ordinary values', () => {
  for (const value of [null, undefined, 0, '', 'SELECT', {}, [], Object.create(null), false, 1n]) {
    assert.equal(isSqlFragment(value), false);
  }
});

test('compileQuery requires a real fragment', () => {
  forgeries().forEach((forgery, index) => {
    assertThrowsCode(() => compileQuery(forgery), CODE.INVALID_FRAGMENT);
  });
});

test('JSON-shaped raw SQL payloads cannot forge fragments', () => {
  const forged = JSON.parse('{"__sql":"OR 1=1","strings":["SELECT "],"values":[]}');
  assertThrowsCode(() => compileQuery(forged), CODE.INVALID_FRAGMENT);
  assert.equal(isSqlFragment(forged), false);
});

test('copying the private symbol from a real fragment still cannot forge one', () => {
  const real = sql`SELECT 1`;
  const symbol = Object.getOwnPropertySymbols(real)[0];
  const forged = { [symbol]: true };
  assert.equal(isSqlFragment(forged), false);
  assertThrowsCode(() => compileQuery(forged), CODE.INVALID_FRAGMENT);
});

test('plain string calls fail closed as not tagged templates', () => {
  assertThrowsCode(() => sql('SELECT * FROM users WHERE id = ' + '1'), CODE.NOT_TAGGED_TEMPLATE);
});

test('array calls fail closed as not tagged templates', () => {
  assertThrowsCode(() => sql(['SELECT '], [1]), CODE.NOT_TAGGED_TEMPLATE);
});

test('frozen array calls without raw fail closed', () => {
  const strings = Object.freeze(['SELECT ', '']);
  assertThrowsCode(() => sql(strings, 1), CODE.NOT_TAGGED_TEMPLATE);
});

test('unfrozen template-shaped arrays fail closed', () => {
  const raw = ['SELECT ', ''];
  const strings = ['SELECT ', ''];
  strings.raw = raw;
  assertThrowsCode(() => sql(strings, 1), CODE.NOT_TAGGED_TEMPLATE);
});

test('frozen template-shaped arrays with unfrozen raw fail closed', () => {
  const raw = ['SELECT ', ''];
  const strings = ['SELECT ', ''];
  strings.raw = raw;
  Object.freeze(strings);
  assertThrowsCode(() => sql(strings, 1), CODE.NOT_TAGGED_TEMPLATE);
});

test('template-shaped arrays with the wrong arity fail closed', () => {
  const raw = Object.freeze(['SELECT ', '']);
  const strings = ['SELECT ', ''];
  strings.raw = raw;
  Object.freeze(strings);
  assertThrowsCode(() => sql(strings), CODE.NOT_TAGGED_TEMPLATE);
  assertThrowsCode(() => sql(strings, 1, 2), CODE.NOT_TAGGED_TEMPLATE);
});

test('empty templates compile to empty SQL', () => {
  assert.equal(textOf(sql``), '');
  assert.deepEqual(pg(sql``).values, []);
});

test('static templates compile byte-for-byte in every dialect', () => {
  const source = 'SELECT *\nFROM users\nWHERE active = TRUE';
  assert.equal(textOf(sql`SELECT *
FROM users
WHERE active = TRUE`), source);
  assert.equal(my(sql`SELECT *
FROM users
WHERE active = TRUE`).sql, source);
  assert.equal(lite(sql`SELECT *
FROM users
WHERE active = TRUE`).sql, source);
});

test('postgres uses one-based numbered placeholders', () => {
  const result = pg(sql`SELECT * FROM users WHERE id = ${10} AND email = ${'a@example.test'} AND active = ${true}`);
  assert.equal(result.text, 'SELECT * FROM users WHERE id = $1 AND email = $2 AND active = $3');
  assert.deepEqual(result.values, [10, 'a@example.test', true]);
});

test('mysql uses question-mark placeholders and values', () => {
  const result = my(sql`SELECT * FROM users WHERE id = ${10} AND email = ${'a@example.test'}`);
  assert.equal(result.sql, 'SELECT * FROM users WHERE id = ? AND email = ?');
  assert.deepEqual(result.values, [10, 'a@example.test']);
  assert.equal(result.text, undefined);
});

test('sqlite uses question-mark placeholders and params', () => {
  const result = lite(sql`SELECT * FROM users WHERE id = ${10} AND email = ${'a@example.test'}`);
  assert.equal(result.sql, 'SELECT * FROM users WHERE id = ? AND email = ?');
  assert.deepEqual(result.params, [10, 'a@example.test']);
  assert.equal(result.values, undefined);
});

test('compiled query objects and parameter arrays are frozen', () => {
  const result = pg(sql`SELECT ${1}`);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.values), true);
});

test('nested fragments compile depth-first in parameter order', () => {
  const inner = sql`a = ${1} AND b = ${2}`;
  const middle = sql`(${inner}) OR c = ${3}`;
  const outer = sql`SELECT * FROM t WHERE ${middle} AND d = ${4}`;
  const result = pg(outer);
  assert.equal(result.text, 'SELECT * FROM t WHERE (a = $1 AND b = $2) OR c = $3 AND d = $4');
  assert.deepEqual(result.values, [1, 2, 3, 4]);
});

test('adjacent parameters remain distinct', () => {
  const result = pg(sql`${1}${2}${3}`);
  assert.equal(result.text, '$1$2$3');
  assert.deepEqual(result.values, [1, 2, 3]);
});

test('the same nested fragment can be reused and parameters duplicate deliberately', () => {
  const part = sql`x = ${'v'}`;
  const result = pg(sql`SELECT ${1} WHERE ${part} OR ${part}`);
  assert.equal(result.text, 'SELECT $1 WHERE x = $2 OR x = $3');
  assert.deepEqual(result.values, [1, 'v', 'v']);
});

test('compilation does not mutate fragments when compiled repeatedly', () => {
  const fragment = sql`SELECT ${1}`;
  assert.deepEqual(pg(fragment), pg(fragment));
});

test('undefined parameters fail closed by default', () => {
  assertThrowsCode(() => pg(sql`SELECT ${undefined}`), CODE.INVALID_PARAMETER);
});

test('NaN parameters fail closed by default', () => {
  assertThrowsCode(() => pg(sql`SELECT ${Number.NaN}`), CODE.INVALID_PARAMETER);
});

test('Infinity parameters fail closed by default', () => {
  assertThrowsCode(() => pg(sql`SELECT ${Number.POSITIVE_INFINITY}`), CODE.INVALID_PARAMETER);
});

test('negative Infinity parameters fail closed by default', () => {
  assertThrowsCode(() => pg(sql`SELECT ${Number.NEGATIVE_INFINITY}`), CODE.INVALID_PARAMETER);
});

test('symbol parameters fail closed by default', () => {
  assertThrowsCode(() => pg(sql`SELECT ${Symbol('x')}`), CODE.INVALID_PARAMETER);
});

test('function parameters fail closed by default', () => {
  assertThrowsCode(() => pg(sql`SELECT ${() => 1}`), CODE.INVALID_PARAMETER);
});

test('plain object parameters fail closed by default', () => {
  assertThrowsCode(() => pg(sql`SELECT ${{ a: 1 }}`), CODE.INVALID_PARAMETER);
});

test('array parameters fail closed by default', () => {
  assertThrowsCode(() => pg(sql`SELECT ${[1, 2]}`), CODE.INVALID_PARAMETER);
});

test('class instances fail closed even with allowObjects', () => {
  class Example { constructor() { this.a = 1; } }
  assertThrowsCode(() => pg(sql`SELECT ${new Example()}`, { allowObjects: true }), CODE.INVALID_PARAMETER);
});

test('invalid Date parameters fail closed', () => {
  assertThrowsCode(() => pg(sql`SELECT ${new Date('not a date')}`), CODE.INVALID_PARAMETER);
});

test('valid scalar parameter types compile', () => {
  const date = new Date('2026-01-02T03:04:05.000Z');
  const bytes = new Uint8Array([1, 2, 3]);
  const result = pg(sql`SELECT ${null}, ${true}, ${false}, ${0}, ${-1.5}, ${'text'}, ${10n}, ${date}, ${bytes}`);
  assert.deepEqual(result.values.slice(0, 7), [null, true, false, 0, -1.5, 'text', 10n]);
  assert.equal(result.values[7], date);
  assert.equal(result.values[8], bytes);
});

test('allowUndefined explicitly permits undefined values', () => {
  const result = pg(sql`SELECT ${undefined}`, { allowUndefined: true });
  assert.deepEqual(result.values, [undefined]);
});

test('allowNonFiniteNumbers explicitly permits NaN and infinities', () => {
  const result = pg(sql`SELECT ${Number.NaN}, ${Infinity}, ${-Infinity}`, { allowNonFiniteNumbers: true });
  assert.equal(Number.isNaN(result.values[0]), true);
  assert.equal(result.values[1], Infinity);
  assert.equal(result.values[2], -Infinity);
});

test('allowObjects permits JSON-shaped plain objects and arrays', () => {
  const object = { a: [1, 'x', null], b: { c: true } };
  const array = [1, 'x', null, { d: false }];
  const result = pg(sql`SELECT ${object}, ${array}`, { allowObjects: true });
  assert.equal(result.values[0], object);
  assert.equal(result.values[1], array);
});

test('allowObjects rejects circular structures by depth bound', () => {
  const circular = {};
  circular.self = circular;
  assertThrowsCode(() => pg(sql`SELECT ${circular}`, { allowObjects: true }), CODE.INVALID_PARAMETER);
});

test('allowObjects rejects nested undefined values', () => {
  assertThrowsCode(() => pg(sql`SELECT ${{ a: undefined }}`, { allowObjects: true }), CODE.INVALID_PARAMETER);
});

test('allowObjects rejects nested functions', () => {
  assertThrowsCode(() => pg(sql`SELECT ${{ a() {} }}`, { allowObjects: true }), CODE.INVALID_PARAMETER);
});

test('allowObjects rejects nested non-finite numbers', () => {
  assertThrowsCode(() => pg(sql`SELECT ${{ a: NaN }}`, { allowObjects: true }), CODE.INVALID_PARAMETER);
});

test('allowSymbols explicitly permits symbol values', () => {
  const symbol = Symbol('explicit');
  assert.equal(pg(sql`SELECT ${symbol}`, { allowSymbols: true }).values[0], symbol);
});

test('allowFunctions explicitly permits function values', () => {
  const fn = () => 1;
  assert.equal(pg(sql`SELECT ${fn}`, { allowFunctions: true }).values[0], fn);
});

test('parameter cap defaults to 1000 and permits exactly 1000', () => {
  const parts = [];
  for (let index = 0; index < 1000; index += 1) parts.push(sql`${index}`);
  const result = pg(sql`SELECT ${sqlJoin(parts, ', ')}`);
  assert.equal(result.values.length, 1000);
});

test('parameter cap rejects parameter 1001 by default', () => {
  const parts = [];
  for (let index = 0; index < 1001; index += 1) parts.push(sql`${index}`);
  assertThrowsCode(() => pg(sql`SELECT ${sqlJoin(parts, ', ')}`), CODE.MAX_PARAMETERS);
});

test('custom maxParameters is enforced', () => {
  assertThrowsCode(() => pg(sql`SELECT ${1}, ${2}`, { maxParameters: 1 }), CODE.MAX_PARAMETERS);
  assert.equal(pg(sql`SELECT ${1}`, { maxParameters: 1 }).values.length, 1);
});

test('maxSqlLength is enforced for static SQL', () => {
  assertThrowsCode(() => pg(sql`SELECT 12345`, { maxSqlLength: 5 }), CODE.MAX_SQL_LENGTH);
});

test('maxSqlLength exact boundary succeeds', () => {
  assert.equal(pg(sql`12345`, { maxSqlLength: 5 }).text, '12345');
});

test('maxSqlLength counts generated placeholders', () => {
  assertThrowsCode(() => pg(sql`SELECT ${123456789}`, { maxSqlLength: 8 }), CODE.MAX_SQL_LENGTH);
  assert.equal(pg(sql`SELECT ${123456789}`, { maxSqlLength: 9 }).text, 'SELECT $1');
});

test('fragment nesting at depth 32 compiles iteratively', () => {
  let fragment = sql`x`;
  for (let depth = 0; depth < 32; depth += 1) {
    fragment = sql`(${fragment})`;
  }
  assert.equal(textOf(fragment).length, 65);
});

test('fragment nesting beyond depth 32 fails closed', () => {
  let fragment = sql`x`;
  for (let depth = 0; depth < 33; depth += 1) {
    fragment = sql`(${fragment})`;
  }
  assertThrowsCode(() => pg(fragment), CODE.MAX_FRAGMENT_DEPTH);
});

test('custom maxFragmentDepth is enforced', () => {
  const inner = sql`x`;
  const outer = sql`(${inner})`;
  assertThrowsCode(() => pg(outer, { maxFragmentDepth: 0 }), CODE.INVALID_OPTIONS);
  assertThrowsCode(() => pg(sql`(${sql`(${inner}`})`, { maxFragmentDepth: 1 }), CODE.MAX_FRAGMENT_DEPTH);
  assert.equal(pg(outer, { maxFragmentDepth: 1 }).text, '(x)');
});

test('deep compilation does not recurse even at the maximum configurable depth', () => {
  let fragment = sql`${0}`;
  for (let depth = 0; depth < 128; depth += 1) {
    fragment = sql`(${fragment})`;
  }
  assert.equal(pg(fragment, { maxFragmentDepth: 128 }).values.length, 1);
});

test('invalid dialects fail closed', () => {
  for (const dialect of ['POSTGRES', 'pg', 'mysql2', '', 1, null, {}, []]) {
    assertThrowsCode(() => compileQuery(sql`SELECT 1`, { dialect }), CODE.INVALID_DIALECT);
  }
});

test('invalid compile caps fail closed', () => {
  const cases = [
    { maxParameters: 0 },
    { maxParameters: 1.5 },
    { maxParameters: '10' },
    { maxSqlLength: 0 },
    { maxSqlLength: -1 },
    { maxFragmentDepth: 0 },
    { maxFragmentDepth: 129 },
    { maxFragmentDepth: Number.MAX_SAFE_INTEGER + 1 }
  ];
  for (const options of cases) {
    assertThrowsCode(() => compileQuery(sql`SELECT 1`, options), CODE.INVALID_OPTIONS);
  }
});

test('createSqlCage compiles with its configured dialect', () => {
  const cage = createSqlCage({ dialect: 'mysql' });
  const result = cage.compile(cage.sql`SELECT ${1}`);
  assert.deepEqual(result.values, [1]);
  assert.equal(result.sql, 'SELECT ?');
  assert.equal(result.text, undefined);
});

test('createSqlCage compile options can override the base dialect', () => {
  const cage = createSqlCage({ dialect: 'mysql' });
  const result = cage.compile(sql`SELECT ${1}`, { dialect: 'sqlite' });
  assert.deepEqual(result.params, [1]);
});

test('createSqlCage exposes immutable normalized options', () => {
  const cage = createSqlCage({ dialect: 'sqlite', maxParameters: 7 });
  assert.equal(cage.dialect, 'sqlite');
  assert.equal(cage.options.maxParameters, 7);
  assert.equal(Object.isFrozen(cage), true);
  assert.equal(Object.isFrozen(cage.options), true);
});

test('createSqlCage quoteIdentifier uses the configured dialect', () => {
  assert.equal(createSqlCage({ dialect: 'mysql' }).quoteIdentifier('users'), '`users`');
  assert.equal(createSqlCage({ dialect: 'sqlite' }).quoteIdentifier('users'), '"users"');
});

test('createSqlCage schema uses the configured dialect', () => {
  const cage = createSqlCage({ dialect: 'mysql' });
  const guard = cage.schema({ users: ['id'] });
  assert.equal(cage.compile(sql`SELECT ${guard.column('users', 'id')}`).sql, 'SELECT `users`.`id`');
});

test('SqlCageError exposes stable name, code, and details', () => {
  const error = new SqlCageError(CODE.INVALID_INPUT, 'message', { a: 1 });
  assert.equal(error.name, 'SqlCageError');
  assert.equal(error.code, CODE.INVALID_INPUT);
  assert.deepEqual(error.details, { a: 1 });
  assert.equal(error instanceof Error, true);
});

test('helpers return genuine fragments', () => {
  assert.equal(isSqlFragment(sqlJoin([sql`a`, sql`b`])), true);
});

test('default export contains the public API', () => {
  for (const key of ['sql', 'compileQuery', 'createSqlCage', 'quoteIdentifier', 'createSchemaGuard', 'auditSqlQuery']) {
    assert.equal(typeof sqlcage[key], 'function');
  }
  assert.equal(sqlcage.CODE, CODE);
});

function forgeries() {
  const arrayObject = Object.freeze(['SELECT ']);
  return [
    null,
    undefined,
    'SELECT 1',
    0,
    true,
    {},
    [],
    arrayObject,
    { __sql: 'OR 1=1' },
    { strings: Object.freeze(['SELECT ']), values: Object.freeze([]) },
    Object.create(null),
    new String('SELECT 1')
  ];
}
