import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CODE,
  createSchemaGuard,
  isSqlFragment,
  isValidIdentifier,
  quoteIdentifier,
  safeColumns,
  safeLimitOffset,
  safeOrderBy,
  sql
} from '../src/index.mjs';
import { assertThrowsCode, lite, my, pg, sampleSchema, textOf } from './test-utils.mjs';

const validIdentifiers = [
  'a', 'z', 'A', 'Z', '_', 'abc', 'ABC', '_abc', 'a1', '_1', 'a_b_c',
  'users', 'user_id', 'created_at', 'x'.repeat(63), '_' + 'x'.repeat(62),
  'a0_', 'A9z_', 't2', 'col_2026', 'order_items', 'invoiceLine', 'ID', 'x_y_z_9'
];
for (const identifier of validIdentifiers) {
  test('valid identifier accepted: ' + JSON.stringify(identifier.slice(0, 30)), () => {
    assert.equal(isValidIdentifier(identifier), true);
    assert.equal(typeof quoteIdentifier(identifier), 'string');
  });
}

const invalidIdentifiers = [
  '', '0', '9abc', '1_user', 'a b', 'a-b', 'a.b', 'a"b', "a'b", 'a`b',
  'a;b', 'a--b', 'a/*b', 'a*/b', 'a/b', 'a\\b', 'a\b', 'a\0b',
  'é', 'éabc', 'aé', '_é', 'αbeta', 'a$d', 'a@d', 'a#d', 'a!d', 'a?d',
  'a,d', 'a(d', 'a)d', 'a[d', 'a]d', 'a{d', 'a}d', 'a\nd', 'a\rd', 'a\td',
  'a\vd', 'a\fd', 'a\x7fd', 'x'.repeat(64), ' x', 'x ', '*',
  '__proto__', 'constructor', 'prototype', '__PROTO__', 'Constructor', 'PROTOTYPE'
];
for (const identifier of invalidIdentifiers) {
  test('invalid identifier rejected: ' + JSON.stringify(identifier.slice(0, 30)), () => {
    assert.equal(isValidIdentifier(identifier), false);
    assertThrowsCode(() => quoteIdentifier(identifier), CODE.INVALID_IDENTIFIER);
  });
}

for (const [dialect, open, close] of [['postgres', '"', '"'], ['mysql', '`', '`'], ['sqlite', '"', '"']]) {
  for (const name of ['users', 'user_id', '_x9']) {
    test('quoteIdentifier quotes ' + name + ' for ' + dialect, () => {
      assert.equal(quoteIdentifier(name, dialect), open + name + close);
      assert.equal(quoteIdentifier(name, { dialect }), open + name + close);
    });
  }
}

test('quoteIdentifier defaults to postgres double quotes', () => {
  assert.equal(quoteIdentifier('users'), '"users"');
});

test('quoteIdentifier rejects invalid dialects', () => {
  for (const dialect of ['POSTGRES', 'mssql', '', 1, null]) {
    assertThrowsCode(() => quoteIdentifier('users', dialect), CODE.INVALID_DIALECT);
  }
});

test('safeColumns deduplicates and quotes a strict allowlist', () => {
  const fragment = safeColumns(['id', 'email', 'id', 'name'], ['id', 'email', 'name']);
  assert.equal(isSqlFragment(fragment), true);
  assert.equal(textOf(sql`SELECT ${fragment}`), 'SELECT "id", "email", "name"');
});

test('safeColumns can qualify columns with a validated table', () => {
  const fragment = safeColumns(['id', 'email'], ['id', 'email'], { table: 'users' });
  assert.equal(textOf(sql`SELECT ${fragment}`), 'SELECT "users"."id", "users"."email"');
});

test('safeColumns quotes for mysql', () => {
  const fragment = safeColumns(['id'], ['id'], { dialect: 'mysql', table: 'users' });
  assert.equal(my(sql`SELECT ${fragment}`).sql, 'SELECT `users`.`id`');
});

test('safeColumns quotes for sqlite', () => {
  const fragment = safeColumns(['id'], ['id'], { dialect: 'sqlite', table: 'users' });
  assert.equal(lite(sql`SELECT ${fragment}`).sql, 'SELECT "users"."id"');
});

test('safeColumns rejects a column outside the allowlist', () => {
  assertThrowsCode(() => safeColumns(['id', 'password_hash'], ['id']), CODE.UNKNOWN_COLUMN);
});

test('safeColumns rejects empty input', () => {
  assertThrowsCode(() => safeColumns([], ['id']), CODE.EMPTY_COLUMN_LIST);
});

test('safeColumns rejects non-array input', () => {
  for (const input of ['id', null, undefined, {}, 1]) {
    assertThrowsCode(() => safeColumns(input, ['id']), CODE.EMPTY_COLUMN_LIST);
  }
});

test('safeColumns rejects malformed allowed column collections', () => {
  for (const input of [null, undefined, {}, 'id', 1]) {
    assertThrowsCode(() => safeColumns(['id'], input), CODE.INVALID_SCHEMA);
  }
});

test('safeColumns accepts a Set allowlist', () => {
  assert.equal(textOf(sql`${safeColumns(['id'], new Set(['id']))}`), '"id"');
});

test('safeColumns cap counts unique columns', () => {
  assert.equal(textOf(sql`${safeColumns(['id', 'id', 'name'], ['id', 'name'], { maxColumns: 2 })}`), '"id", "name"');
  assertThrowsCode(() => safeColumns(['id', 'name'], ['id', 'name'], { maxColumns: 1 }), CODE.INVALID_OPTIONS);
});

test('safeOrderBy parses safe compact strings', () => {
  const fragment = safeOrderBy('created_at:desc,id:asc', ['created_at', 'id']);
  assert.equal(textOf(sql`${fragment}`), 'ORDER BY "created_at" DESC, "id" ASC');
});

test('safeOrderBy string clauses default to ASC', () => {
  assert.equal(textOf(sql`${safeOrderBy('id', ['id'])}`), 'ORDER BY "id" ASC');
});

test('safeOrderBy validates array clauses and NULLS ordering', () => {
  const fragment = safeOrderBy([{ column: 'created_at', direction: 'DESC', nulls: 'LAST' }], ['created_at']);
  assert.equal(textOf(sql`${fragment}`), 'ORDER BY "created_at" DESC NULLS LAST');
});

test('safeOrderBy supports sqlite NULLS ordering', () => {
  const fragment = safeOrderBy([{ column: 'id', direction: 'ASC', nulls: 'FIRST' }], ['id'], { dialect: 'sqlite' });
  assert.equal(lite(sql`${fragment}`).sql, 'ORDER BY "id" ASC NULLS FIRST');
});

test('safeOrderBy rejects NULLS ordering for mysql', () => {
  assertThrowsCode(
    () => safeOrderBy([{ column: 'id', direction: 'ASC', nulls: 'FIRST' }], ['id'], { dialect: 'mysql' }),
    CODE.INVALID_ORDER_BY
  );
});

test('safeOrderBy rejects columns outside the sortable allowlist', () => {
  assertThrowsCode(() => safeOrderBy('password_hash:desc', ['id']), CODE.UNKNOWN_COLUMN);
});

test('safeOrderBy rejects duplicate columns', () => {
  assertThrowsCode(() => safeOrderBy('id:asc,id:desc', ['id']), CODE.INVALID_ORDER_BY);
});

test('safeOrderBy rejects malformed directions', () => {
  for (const direction of ['down', '', 'ASCENDING', 'asc']) {
    assertThrowsCode(() => safeOrderBy([{ column: 'id', direction }], ['id']), CODE.INVALID_ORDER_BY);
  }
});

test('safeOrderBy compact strings accept lowercase directions only in string form', () => {
  assert.equal(textOf(sql`${safeOrderBy('id:desc', ['id'])}`), 'ORDER BY "id" DESC');
  assert.equal(textOf(sql`${safeOrderBy('id:asc', ['id'])}`), 'ORDER BY "id" ASC');
});

test('safeOrderBy rejects malformed string shapes', () => {
  for (const input of ['', ' ', 'id,', ',id', 'id::asc', ':desc', 'id:down', 'id:asc:wrong']) {
    assertThrowsCode(() => safeOrderBy(input, ['id']), CODE.INVALID_ORDER_BY);
  }
});

test('safeOrderBy rejects non-object array clauses', () => {
  for (const input of [['id'], [null], [1], [[]]]) {
    assertThrowsCode(() => safeOrderBy(input, ['id']), CODE.INVALID_ORDER_BY);
  }
});

test('safeOrderBy rejects empty arrays', () => {
  assertThrowsCode(() => safeOrderBy([], ['id']), CODE.EMPTY_ORDER_BY);
});

test('safeOrderBy enforces maxClauses', () => {
  assert.equal(textOf(sql`${safeOrderBy('id:asc,name:asc', ['id', 'name'], { maxClauses: 2 })}`), 'ORDER BY "id" ASC, "name" ASC');
  assertThrowsCode(() => safeOrderBy('id:asc,name:asc', ['id', 'name'], { maxClauses: 1 }), CODE.INVALID_ORDER_BY);
});

test('safeOrderBy can qualify sort columns with a table', () => {
  const fragment = safeOrderBy('id:desc', ['id'], { table: 'users', dialect: 'mysql' });
  assert.equal(my(sql`${fragment}`).sql, 'ORDER BY `users`.`id` DESC');
});

test('safeLimitOffset binds limit and offset as parameters', () => {
  const result = pg(sql`SELECT * FROM users ${safeLimitOffset({ limit: 25, offset: 50, maxLimit: 100 })}`);
  assert.equal(result.text, 'SELECT * FROM users LIMIT $1 OFFSET $2');
  assert.deepEqual(result.values, [25, 50]);
});

test('safeLimitOffset defaults offset to zero', () => {
  assert.deepEqual(pg(sql`${safeLimitOffset({ limit: 1 })}`).values, [1, 0]);
});

const invalidLimitInputs = [
  {}, { limit: 0 }, { limit: -1 }, { limit: 1.5 }, { limit: '10' }, { limit: true },
  { limit: NaN }, { limit: Infinity }, { limit: 10, offset: -1 }, { limit: 10, offset: 1.2 },
  { limit: 10, offset: '0' }, { limit: 10, maxLimit: 0 }, { limit: 11, maxLimit: 10 },
  { limit: Number.MAX_SAFE_INTEGER + 1 }, { limit: 1, offset: Number.MAX_SAFE_INTEGER + 1 }
];
for (const input of invalidLimitInputs) {
  test('safeLimitOffset rejects ' + JSON.stringify(input), () => {
    assertThrowsCode(() => safeLimitOffset(input), CODE.INVALID_LIMIT_OFFSET);
  });
}

test('safeLimitOffset accepts safe boundary values', () => {
  assert.deepEqual(pg(sql`${safeLimitOffset({ limit: 1000, offset: Number.MAX_SAFE_INTEGER - 1 })}`).values, [1000, Number.MAX_SAFE_INTEGER - 1]);
});

test('createSchemaGuard accepts object and shorthand table specifications', () => {
  const guard = createSchemaGuard(sampleSchema);
  assert.deepEqual(guard.tables, ['users', 'posts']);
  assert.equal(guard.dialect, 'postgres');
  assert.equal(Object.isFrozen(guard), true);
});

test('schema guard table returns a validated table fragment', () => {
  const guard = createSchemaGuard(sampleSchema);
  assert.equal(textOf(sql`SELECT * FROM ${guard.table('users')}`), 'SELECT * FROM "users"');
});

test('schema guard column returns a qualified validated column fragment', () => {
  const guard = createSchemaGuard(sampleSchema);
  assert.equal(textOf(sql`SELECT ${guard.column('users', 'email')}`), 'SELECT "users"."email"');
});

test('schema guard columns validates and deduplicates a list', () => {
  const guard = createSchemaGuard(sampleSchema);
  assert.equal(textOf(sql`SELECT ${guard.columns('users', ['id', 'email', 'id'])}`), 'SELECT "users"."id", "users"."email"');
});

test('schema guard orderBy uses sortable columns, not every column', () => {
  const guard = createSchemaGuard(sampleSchema);
  assert.equal(textOf(sql`${guard.orderBy('users', 'created_at:desc')}`), 'ORDER BY "users"."created_at" DESC');
  assertThrowsCode(() => guard.orderBy('users', 'email:asc'), CODE.UNKNOWN_COLUMN);
});

test('schema shorthand makes every column sortable by default', () => {
  const guard = createSchemaGuard(sampleSchema);
  assert.equal(textOf(sql`${guard.orderBy('posts', 'published_at:desc')}`), 'ORDER BY "posts"."published_at" DESC');
});

test('schema explicit empty sortable list forbids ORDER BY', () => {
  const guard = createSchemaGuard({ users: { columns: ['id'], sortable: [] } });
  assertThrowsCode(() => guard.orderBy('users', 'id:asc'), CODE.UNKNOWN_COLUMN);
});

test('schema guard limitOffset binds safe pagination parameters', () => {
  const guard = createSchemaGuard(sampleSchema);
  const result = pg(sql`${guard.limitOffset({ limit: 10, offset: 20, maxLimit: 50 })}`);
  assert.equal(result.text, 'LIMIT $1 OFFSET $2');
  assert.deepEqual(result.values, [10, 20]);
});

test('schema guard composes a complete safe SELECT query', () => {
  const guard = createSchemaGuard(sampleSchema);
  const result = pg(sql`SELECT ${guard.columns('users', ['id', 'email'])}
FROM ${guard.table('users')}
WHERE ${guard.column('users', 'id')} = ${42}
${guard.orderBy('users', 'created_at:desc')}
${guard.limitOffset({ limit: 10 })}`);
  assert.equal(result.text, 'SELECT "users"."id", "users"."email"\nFROM "users"\nWHERE "users"."id" = $1\nORDER BY "users"."created_at" DESC\nLIMIT $2 OFFSET $3');
  assert.deepEqual(result.values, [42, 10, 0]);
});

test('schema guard mysql output uses backticks', () => {
  const guard = createSchemaGuard(sampleSchema, { dialect: 'mysql' });
  const result = my(sql`SELECT ${guard.column('users', 'id')} FROM ${guard.table('users')}`);
  assert.equal(result.sql, 'SELECT `users`.`id` FROM `users`');
});

test('schema guard sqlite output uses double quotes', () => {
  const guard = createSchemaGuard(sampleSchema, { dialect: 'sqlite' });
  const result = lite(sql`SELECT ${guard.column('users', 'id')} FROM ${guard.table('users')}`);
  assert.equal(result.sql, 'SELECT "users"."id" FROM "users"');
});

test('schema guard rejects unknown tables', () => {
  const guard = createSchemaGuard(sampleSchema);
  for (const method of [
    () => guard.table('missing'),
    () => guard.column('missing', 'id'),
    () => guard.columns('missing', ['id']),
    () => guard.orderBy('missing', 'id:asc'),
    () => guard.columnsFor('missing')
  ]) {
    assertThrowsCode(method, CODE.UNKNOWN_TABLE);
  }
});

test('schema guard rejects unknown columns', () => {
  const guard = createSchemaGuard(sampleSchema);
  assertThrowsCode(() => guard.column('users', 'password_hash'), CODE.UNKNOWN_COLUMN);
  assertThrowsCode(() => guard.columns('users', ['id', 'password_hash']), CODE.UNKNOWN_COLUMN);
});

test('schema guard hasTable and hasColumn never trust prototypes', () => {
  const guard = createSchemaGuard(sampleSchema);
  assert.equal(guard.hasTable('users'), true);
  assert.equal(guard.hasTable('constructor'), false);
  assert.equal(guard.hasColumn('users', 'email'), true);
  assert.equal(guard.hasColumn('users', 'constructor'), false);
});

test('schema guard exposed column arrays are frozen', () => {
  const guard = createSchemaGuard(sampleSchema);
  assert.equal(Object.isFrozen(guard.columnsFor('users')), true);
  assert.equal(Object.isFrozen(guard.sortableFor('users')), true);
  assert.equal(Object.isFrozen(guard.tables), true);
});

test('schema guard rejects malformed schema roots', () => {
  for (const schema of [null, undefined, [], 'users', 1, {}]) {
    assertThrowsCode(() => createSchemaGuard(schema), CODE.INVALID_SCHEMA);
  }
});

test('schema guard rejects invalid table names', () => {
  for (const table of ['0table', 'a b', 'a;b', 'x'.repeat(64)]) {
    const schema = {};
    schema[table] = ['id'];
    assertThrowsCode(() => createSchemaGuard(schema), CODE.INVALID_IDENTIFIER);
  }
  assertThrowsCode(() => createSchemaGuard(JSON.parse('{"__proto__":["id"]}')), CODE.INVALID_IDENTIFIER);
});

test('schema guard fails closed when __proto__ assignment mutates the schema object prototype', () => {
  const schema = {};
  schema.__proto__ = ['id'];
  assertThrowsCode(() => createSchemaGuard(schema), CODE.INVALID_SCHEMA);
});

test('schema guard rejects malformed table specs', () => {
  for (const spec of [null, undefined, {}, { columns: [] }, { columns: 'id' }, 1, 'id']) {
    assertThrowsCode(() => createSchemaGuard({ users: spec }), CODE.INVALID_SCHEMA);
  }
});

test('schema guard rejects invalid and duplicate columns', () => {
  assertThrowsCode(() => createSchemaGuard({ users: ['id', 'id'] }), CODE.INVALID_SCHEMA);
  assertThrowsCode(() => createSchemaGuard({ users: ['id', 'bad name'] }), CODE.INVALID_IDENTIFIER);
});

test('schema guard rejects sortable columns that are not declared', () => {
  assertThrowsCode(() => createSchemaGuard({ users: { columns: ['id'], sortable: ['email'] } }), CODE.INVALID_SCHEMA);
});

test('schema guard rejects duplicate sortable columns', () => {
  assertThrowsCode(() => createSchemaGuard({ users: { columns: ['id'], sortable: ['id', 'id'] } }), CODE.INVALID_SCHEMA);
});

test('schema guard supports sortableColumns as an alias', () => {
  const guard = createSchemaGuard({ users: { columns: ['id', 'email'], sortableColumns: ['email'] } });
  assert.deepEqual(guard.sortableFor('users'), ['email']);
});

test('schema guard enforces maxTables', () => {
  assertThrowsCode(() => createSchemaGuard({ a: ['id'], b: ['id'] }, { maxTables: 1 }), CODE.INVALID_SCHEMA);
});

test('schema guard enforces maxColumns', () => {
  assertThrowsCode(() => createSchemaGuard({ users: ['id', 'email'] }, { maxColumns: 1 }), CODE.INVALID_SCHEMA);
});

test('schema guard result cannot be used to mutate the normalized schema', () => {
  const guard = createSchemaGuard(sampleSchema);
  assertThrowsTypeError(() => { guard.tables.push('evil'); });
  assertThrowsTypeError(() => { guard.columnsFor('users').push('evil'); });
});

test('schema guard validates table names before allowlist lookup', () => {
  const guard = createSchemaGuard(sampleSchema);
  assertThrowsCode(() => guard.table('users;DROP'), CODE.INVALID_IDENTIFIER);
});

function assertThrowsTypeError(callback) {
  assert.throws(callback, TypeError);
}
