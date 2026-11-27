import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CODE,
  auditSqlQuery,
  compileQuery,
  createSchemaGuard,
  quoteIdentifier,
  safeColumns,
  safeLimitOffset,
  safeOrderBy,
  sql,
  sqlAnd,
  sqlIn,
  sqlJoin,
  sqlLike,
  sqlOr,
  sqlSet,
  sqlValues
} from '../src/index.mjs';
import { assertThrowsCode, my, pg } from './test-utils.mjs';

function withObjectPrototype(key, value, callback) {
  Object.prototype[key] = value;
  try {
    return callback();
  } finally {
    delete Object.prototype[key];
  }
}

function withArrayHoleValue(value, callback) {
  Object.defineProperty(Array.prototype, '1', {
    value,
    configurable: true,
    writable: true
  });
  try {
    return callback();
  } finally {
    delete Array.prototype[1];
  }
}

test('compile options ignore dialect pollution from Object.prototype', () => {
  withObjectPrototype('dialect', 'mysql', () => {
    const result = compileQuery(sql`SELECT ${1}`);
    assert.equal(result.text, 'SELECT $1');
    assert.equal(result.sql, undefined);
  });
});

test('compile options ignore maxParameters pollution from Object.prototype', () => {
  withObjectPrototype('maxParameters', 1, () => {
    const result = compileQuery(sql`SELECT ${1}, ${2}`);
    assert.deepEqual(result.values, [1, 2]);
  });
});

test('compile options ignore allowObjects pollution from Object.prototype', () => {
  withObjectPrototype('allowObjects', true, () => {
    assertThrowsCode(() => compileQuery(sql`SELECT ${{ a: 1 }}`), CODE.INVALID_PARAMETER);
  });
});

test('helper options ignore inherited dialects and empty-input modes', () => {
  withObjectPrototype('dialect', 'mysql', () => {
    assert.equal(quoteIdentifier('users', {}), '"users"');
    const guard = createSchemaGuard({ users: ['id'] }, {});
    assert.equal(compileQuery(sql`${guard.column('users', 'id')}`).text, '"users"."id"');
  });
  withObjectPrototype('onEmpty', 'false', () => {
    assertThrowsCode(() => sqlIn([]), CODE.EMPTY_IN_LIST);
  });
});

test('ORDER BY clause fields ignore inherited prototype values', () => {
  withObjectPrototype('column', 'id', () => {
    assertThrowsCode(() => safeOrderBy([{}], ['id']), CODE.INVALID_IDENTIFIER);
  });
  withObjectPrototype('direction', 'DESC', () => {
    assert.equal(compileQuery(sql`${safeOrderBy([{ column: 'id' }], ['id'])}`).text, 'ORDER BY "id" ASC');
  });
});

test('sparse fragment arrays fail closed even when Array.prototype supplies a fragment', () => {
  withArrayHoleValue(sql`inherited_hole = ${9}`, () => {
    assertThrowsCode(() => sqlJoin([sql`a`, , sql`c`]), CODE.INVALID_INPUT);
    assertThrowsCode(() => sqlAnd([sql`a`, , sql`c`]), CODE.INVALID_INPUT);
    assertThrowsCode(() => sqlOr([sql`a`, , sql`c`]), CODE.INVALID_INPUT);
  });
});

test('sparse value arrays fail closed even when Array.prototype supplies values', () => {
  withArrayHoleValue('injected-value', () => {
    assertThrowsCode(() => sqlIn([1, , 3]), CODE.INVALID_INPUT);
    assertThrowsCode(() => sqlValues([[1, , 3]]), CODE.EMPTY_VALUES);
    assertThrowsCode(() => sqlValues([{ id: 1 }, , { id: 3 }]), CODE.EMPTY_VALUES);
  });
});

test('sparse identifier and clause arrays fail closed', () => {
  withArrayHoleValue('id', () => {
    assertThrowsCode(() => safeColumns(['id', , 'id'], ['id']), CODE.EMPTY_COLUMN_LIST);
    assertThrowsCode(() => safeColumns(['id'], ['id', , 'id']), CODE.INVALID_SCHEMA);
    assertThrowsCode(() => createSchemaGuard({ users: ['id', , 'email'] }), CODE.INVALID_SCHEMA);
  });
  withArrayHoleValue({ column: 'id', direction: 'ASC' }, () => {
    assertThrowsCode(() => safeOrderBy([{ column: 'other' }, , { column: 'third' }], ['id', 'other', 'third']), CODE.INVALID_ORDER_BY);
  });
});

test('sqlSet and sqlValues reject inherited enumerable data keys', () => {
  withObjectPrototype('inherited_col', 'polluted', () => {
    assertThrowsCode(() => sqlSet({ name: 'x' }), CODE.EMPTY_SET);
    assertThrowsCode(() => sqlValues([{ id: 1 }], { columns: ['id'] }), CODE.EMPTY_VALUES);
  });
});

test('negative zero offset compiles as positive zero in parameters', () => {
  const result = pg(sql`${safeLimitOffset({ limit: 10, offset: -0 })}`);
  assert.deepEqual(result.values, [10, 0]);
  assert.equal(Object.is(result.values[1], -0), false);
});

test('mysql sqlLike uses a mode-independent escape character by default', () => {
  const result = my(sql`${sqlLike('name', '100%_', { dialect: 'mysql' })}`);
  assert.equal(result.sql, '`name` LIKE ? ESCAPE \'!\'');
  assert.deepEqual(result.values, ['%100!%!_%']);
});

test('mysql sqlLike rejects an explicitly mode-dependent backslash escape', () => {
  assertThrowsCode(() => sqlLike('name', 'x', { dialect: 'mysql', escapeChar: '\\' }), CODE.INVALID_LIKE_PATTERN);
});

test('postgres escape strings cannot hide stacked dangerous SQL from the auditor', () => {
  const query = "SELECT E'\\''; DROP TABLE users; --'";
  const result = auditSqlQuery(query, { dialect: 'postgres' });
  const codes = result.findings.map((finding) => finding.code);
  assert.equal(codes.includes(CODE.MULTI_STATEMENT), true);
  assert.equal(codes.includes(CODE.DANGEROUS_KEYWORD), true);
  assert.equal(result.safe, false);
});

test('postgres escape strings remain closed across backslash quote pairs', () => {
  const result = auditSqlQuery("SELECT E'it\\'s -- fine'", { dialect: 'postgres' });
  assert.equal(result.safe, true);
});

test('mysql executable comments expose dangerous SQL to the auditor', () => {
  const result = auditSqlQuery('SELECT 1 /*!50000 DROP TABLE users */', { dialect: 'mysql' });
  assert.equal(result.findings.some((finding) => finding.code === CODE.DANGEROUS_KEYWORD && finding.token === 'DROP'), true);
  assert.equal(result.findings.some((finding) => finding.code === CODE.COMMENT_TOKEN), true);
});

test('mysql executable comments expose stacked statements to the auditor', () => {
  const result = auditSqlQuery('SELECT 1; /*!50000 SELECT 2 */', { dialect: 'mysql' });
  assert.equal(result.findings.some((finding) => finding.code === CODE.MULTI_STATEMENT), true);
});

test('mysql and sqlite block comments do not hide SQL after the first terminator', () => {
  for (const dialect of ['mysql', 'sqlite']) {
    const result = auditSqlQuery('/* outer /* inner */ DROP TABLE users */', { dialect });
    assert.equal(result.findings.some((finding) => finding.code === CODE.DANGEROUS_KEYWORD && finding.token === 'DROP'), true, dialect);
  }
});

test('postgres block comments still nest dialect correctly', () => {
  const result = auditSqlQuery('/* outer /* inner */ DROP TABLE users */', { dialect: 'postgres' });
  assert.equal(result.findings.some((finding) => finding.code === CODE.DANGEROUS_KEYWORD), false);
  assert.equal(result.findings.some((finding) => finding.code === CODE.COMMENT_TOKEN), true);
});

test('mysql double-dash without whitespace is not treated as a comment', () => {
  const result = auditSqlQuery('SELECT 1--x DROP TABLE users', { dialect: 'mysql' });
  assert.equal(result.findings.some((finding) => finding.code === CODE.COMMENT_TOKEN), false);
  assert.equal(result.findings.some((finding) => finding.code === CODE.DANGEROUS_KEYWORD && finding.token === 'DROP'), true);
});

test('static placeholder-shaped text inside literals does not consume parameter numbers', () => {
  const result = pg(sql`SELECT '$1' AS literal_text, ${10} AS bound_value`);
  assert.equal(result.text, 'SELECT \'$1\' AS literal_text, $1 AS bound_value');
  assert.deepEqual(result.values, [10]);
});

test('fragment clones through prototypes and proxies remain rejected', () => {
  const real = sql`SELECT 1`;
  assertThrowsCode(() => compileQuery(Object.create(real)), CODE.INVALID_FRAGMENT);
  assertThrowsCode(() => compileQuery(new Proxy(real, {})), CODE.INVALID_FRAGMENT);
});

test('hostile compact ORDER BY text fails closed', () => {
  assertThrowsCode(() => safeOrderBy('id:desc; DROP TABLE users', ['id']), CODE.INVALID_ORDER_BY);
  assertThrowsCode(() => safeOrderBy('id:asc,__proto__:asc', ['id']), CODE.INVALID_IDENTIFIER);
});

test('huge sparse IN arrays hit the parameter cap before row construction', () => {
  assertThrowsCode(() => sqlIn(new Array(100_001)), CODE.MAX_PARAMETERS);
});

test('twenty thousand nested fragments fail by depth without stack overflow', () => {
  let fragment = sql`x`;
  for (let depth = 0; depth < 20_000; depth += 1) {
    fragment = sql`(${fragment})`;
  }
  assertThrowsCode(() => pg(fragment), CODE.MAX_FRAGMENT_DEPTH);
});
