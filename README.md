# sqlcage

[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/draarivpatel-ui/sqlcage/badge)](https://scorecard.dev/viewer/?uri=github.com/draarivpatel-ui/sqlcage)

sqlcage is a zero-dependency Node.js library for reducing CWE-89 SQL injection risk in applications that build SQL dynamically. It combines a strict tagged-template parameterized query builder, schema-driven identifier allowlists, safe helpers for dynamic SQL shapes, and a lightweight static SQL risk auditor.

The package supports PostgreSQL, MySQL, and SQLite parameter conventions, ships ESM, CommonJS, and TypeScript declarations, and runs on Node.js 18 and later.

## Publication status

This repository is prepared for npm publication as `sqlcage@1.0.0`, but this README does not claim that the package has already been published. Until publication is confirmed, use a local checkout or an `npm pack` tarball in evaluation environments.

## Threat model

Parameterized database drivers are essential, but real applications still encounter SQL injection through shapes that cannot be bound as ordinary values:

1. **Identifiers cannot be parameterized.** Table names, column names, and `ORDER BY` fields are syntax, not values. Passing user-controlled text into those positions is unsafe even when every ordinary value is parameterized.
2. **Dynamic `ORDER BY` clauses are a recurring injection point.** Many drivers and ORMs cannot bind a sort column or direction as a value. Applications often concatenate a request parameter directly into `ORDER BY`.
3. **Dynamic table and column lists need explicit policy.** An allowlist derived from the application schema is safer than quoting whatever identifier text arrives over the network.
4. **`IN`, `VALUES`, and `SET` shapes have variable arity.** Correctly generating one placeholder per item is error-prone, especially for empty `IN` lists and ragged row arrays.
5. **`LIKE` wildcards are not ordinary data when a user controls them.** Unescaped `%` and `_` characters can turn a narrow search into a costly scan. They must be escaped before the pattern is bound.
6. **Template helpers can be accidentally bypassed.** A function named `sql` that also accepts a plain string makes `sql("SELECT ..." + input)` look plausible. sqlcage intentionally fails closed unless it is called by JavaScript's tagged-template mechanism.
7. **Forged raw fragments are dangerous.** Libraries that trust a marker property such as `{ __sql: true }` can be bypassed by JSON input. sqlcage uses a private symbol plus a private weak registry, so JSON-shaped objects cannot become trusted SQL fragments.

## What sqlcage does and does not do

sqlcage provides defense in depth for application-authored SQL. It does not replace a database driver's parameter encoder, a schema migration system, least-privilege database accounts, or review of handwritten SQL.

The static auditor is a lexical risk scanner, not a proof that a query is safe. A clean audit means the scanner found no covered risk markers. It does not prove correct logic, correct permissions, valid syntax, or safety against every database-specific feature.

## Quick start

```js
import { sql, compileQuery } from 'sqlcage';

const userId = 42;
const query = sql`
  SELECT id, email
  FROM users
  WHERE id = ${userId}
`;

const compiled = compileQuery(query, { dialect: 'postgres' });
// {
//   text: 'SELECT id, email\n  FROM users\n  WHERE id = $1',
//   values: [42]
// }
```

The whitespace in this example is preserved exactly as written. sqlcage does not reformat SQL.

### PostgreSQL

PostgreSQL uses numbered parameters:

```js
import { sql, compileQuery } from 'sqlcage';

const email = 'person@example.test';
const compiled = compileQuery(
  sql`SELECT id FROM users WHERE email = ${email}`,
  { dialect: 'postgres' }
);

// Pass to pg:
// await client.query(compiled.text, compiled.values);
```

### MySQL

MySQL uses question-mark parameters:

```js
import { sql, compileQuery } from 'sqlcage';

const compiled = compileQuery(
  sql`SELECT id FROM users WHERE email = ${'person@example.test'}`,
  { dialect: 'mysql' }
);

// Pass to mysql2:
// await connection.execute(compiled.sql, compiled.values);
```

### SQLite

SQLite uses question-mark parameters and a `params` property:

```js
import { sql, compileQuery } from 'sqlcage';

const compiled = compileQuery(
  sql`SELECT id FROM users WHERE email = ${'person@example.test'}`,
  { dialect: 'sqlite' }
);

// compiled.sql is the SQL string.
// compiled.params is the ordered parameter array.
```


## Configured cages

`createSqlCage` binds a dialect and compile policy so repeated callsites do not need to restate them:

```js
import { createSqlCage } from 'sqlcage';

const cage = createSqlCage({
  dialect: 'mysql',
  maxParameters: 100,
  maxSqlLength: 8192
});

const compiled = cage.compile(
  cage.sql`SELECT id FROM users WHERE email = ${email}`
);

// compiled.sql uses ? placeholders.
// compiled.values carries the bound values in order.
```

A cage remains frozen after creation. Per-call compile options can narrow or change compilation explicitly, while `undefined` option values do not erase the cage's configured policy.

## Tagged templates are mandatory

This is safe:

```js
const query = sql`SELECT * FROM users WHERE id = ${userId}`;
```

This is rejected:

```js
sql('SELECT * FROM users WHERE id = ' + userId);
// SqlCageError with SQLCAGE_NOT_TAGGED_TEMPLATE
```

The tagged-template check verifies the observable frozen template-array shape created by JavaScript. It is intentionally strict because a plain function call means string concatenation may already have happened. JavaScript cannot prove the difference between a real template object and a perfectly hand-frozen counterfeit, so applications must use `sql` only as a tag and must never pass attacker-controlled objects to it as an ordinary function argument.

Nested fragments compose without string concatenation:

```js
const active = sql`active = ${true}`;
const query = sql`SELECT id FROM users WHERE ${active} AND id = ${userId}`;
```

Compilation is iterative rather than recursive. Deep fragment trees are bounded by `maxFragmentDepth` and do not depend on call-stack recursion.

## Schema allowlists

Use `createSchemaGuard` when table names, column names, or sort fields depend on application-level input such as a search form, an admin table, or a report builder.

```js
import { sql, compileQuery, createSchemaGuard } from 'sqlcage';

const guard = createSchemaGuard({
  users: {
    columns: ['id', 'email', 'display_name', 'created_at'],
    sortable: ['id', 'created_at']
  }
}, { dialect: 'postgres' });

const fragment = sql`
  SELECT ${guard.columns('users', ['id', 'email'])}
  FROM ${guard.table('users')}
  ${guard.orderBy('users', 'created_at:desc')}
  ${guard.limitOffset({ limit: 25 })}
`;

const compiled = compileQuery(fragment, { dialect: 'postgres' });
```

The SQL shape is allowlisted before compilation:

```sql
SELECT "users"."id", "users"."email"
FROM "users"
ORDER BY "users"."created_at" DESC
LIMIT $1 OFFSET $2
```

`limit` and `offset` are strict integers and are still bound as parameters. They are never interpolated as text.

If `sortable` is omitted, every declared column is sortable. If `sortable: []` is supplied, no column is sortable. This distinction lets schema authors choose between convenience and a fail-closed policy.

## Standalone identifier helpers

`quoteIdentifier` validates strict ASCII identifiers before quoting them:

```js
quoteIdentifier('users', 'postgres'); // "users"
quoteIdentifier('users', 'mysql');    // `users`
quoteIdentifier('users', 'sqlite');   // "users"
```

The default grammar is `^[A-Za-z_][A-Za-z0-9_]{0,62}$`. NUL bytes, quotes, backticks, whitespace, semicolons, comment markers, control characters, Unicode confusables, and the prototype-pollution names `__proto__`, `constructor`, and `prototype` are rejected.

`safeColumns`, `safeOrderBy`, and `safeLimitOffset` are available when a full schema guard is more structure than a callsite needs:

```js
safeColumns(['id', 'email'], ['id', 'email', 'created_at']);
safeOrderBy('created_at:desc,id:asc', ['created_at', 'id']);
safeLimitOffset({ limit: 25, offset: 50, maxLimit: 100 });
```

## Safe `IN` lists

```js
const ids = [10, 11, 12];
const fragment = sql`SELECT id FROM users WHERE id ${sqlIn(ids)}`;
```

This compiles to `IN ($1, $2, $3)` for PostgreSQL. Empty arrays throw `SQLCAGE_EMPTY_IN_LIST` by default because `IN ()` is invalid or dangerously ambiguous in many query builders.

For a complete predicate, prefer the column form:

```js
sql`WHERE ${sqlIn('id', ids, { onEmpty: 'false' })}`
```

When `ids` is empty and `onEmpty: 'false'` is explicit, the column form emits `1 = 0`, which is false and cannot widen the query. The values-only form emits an empty subquery shape containing `1 = 0` so it remains syntactically valid after `IN`.

## Safe `VALUES` rows

```js
const rows = [
  [1, 'Ada'],
  [2, 'Grace']
];

sql`INSERT INTO users (id, display_name) ${sqlValues(rows)}`
```

Array rows must have consistent width. Object rows must have exactly matching keys, and an explicit `columns` option is recommended when key order matters:

```js
sqlValues([
  { id: 1, display_name: 'Ada' },
  { id: 2, display_name: 'Grace' }
], { columns: ['id', 'display_name'] });
```

Every cell is bound as a parameter. Hostile strings are data, not SQL text.

## Safe `SET` assignments

```js
const assignments = {
  display_name: input.name,
  email: input.email
};

sql`UPDATE users ${sqlSet(assignments, { allowedColumns: ['display_name', 'email'] })} WHERE id = ${input.id}`
```

Keys are validated as identifiers, optionally checked against an allowlist, and quoted. Values are bound.

## Safe boolean composition

`sqlAnd`, `sqlOr`, and `sqlJoin` compose only genuine fragments. Raw strings are rejected as fragments, preventing accidental interpolation of attacker-controlled SQL text. `sqlJoin` separators are restricted to commas and whitespace-separated boolean `AND` or `OR` operators rather than arbitrary SQL text.

```js
const where = sqlAnd([
  sql`tenant_id = ${tenantId}`,
  sqlIn('id', ids),
  sqlLike('display_name', search, { mode: 'contains' })
]);

const query = sql`SELECT id FROM users WHERE ${where}`;
```

## Safe `LIKE` patterns

`escapeLikePattern` escapes `%`, `_`, and the escape character itself:

```js
escapeLikePattern('100%_');
// { pattern: '100\\%\\_', escapeChar: '\\' }
```

`sqlLike` wraps the escaped user text according to the requested mode and binds it as a parameter:

```js
sql`SELECT id FROM users WHERE ${sqlLike('display_name', userSearch, { mode: 'contains' })}`
```

PostgreSQL output has this shape:

```sql
"display_name" LIKE $1 ESCAPE '\'
```

Supported modes are `contains`, `startsWith`, and `endsWith`. Wildcards added by the selected mode are intentional. Wildcards inside the user-controlled value are escaped. For MySQL, `sqlLike` uses `!` as its default escape character and rejects an explicit backslash escape character. This avoids the behavior differences created by MySQL `NO_BACKSLASH_ESCAPES` mode.

## Static SQL auditing

`auditSqlQuery` lexically scans SQL while respecting quoted strings, quoted identifiers, dialect-aware comments, PostgreSQL dollar-quoted strings, and PostgreSQL escape strings. MySQL executable comments such as `/*!50000 ... */` are scanned as live SQL because MySQL executes their contents. It reports stable finding codes for:

- executable content after a statement terminator, including forms such as `; SELECT ...`
- comment markers outside literals, including `--`, `/*`, and `#`
- dangerous keyword sequences such as `DROP`, `TRUNCATE`, `ALTER`, `GRANT`, `INTO OUTFILE`, `COPY ... PROGRAM`, `xp_cmdshell`, and `ATTACH DATABASE`
- unterminated quotes, identifiers, dollar strings, and block comments
- NUL bytes
- excessive SQL length

```js
import { auditSqlQuery } from 'sqlcage';

const result = auditSqlQuery('SELECT 1; DROP TABLE users');
// result.safe === false
// result.findings includes SQLCAGE_MULTI_STATEMENT and SQLCAGE_DANGEROUS_KEYWORD
```

The auditor is intentionally strict about comments. A query containing a legitimate SQL comment receives a `SQLCAGE_COMMENT_TOKEN` finding because the auditor is designed to review externally supplied or generated SQL, not to grade handwritten migration files.

## CLI

The CLI audits one file or standard input:

```sh
sqlcage audit query.sql
sqlcage audit query.sql --dialect mysql --json
cat query.sql | sqlcage audit -
```

Exit codes:

- `0` means no findings.
- `1` means one or more audit findings.
- `2` means usage, input, or file-safety failure.

Files are checked with `lstat`, opened read-only with no-follow and non-blocking behavior where the platform supports them, verified again with `fstat`, and rejected unless they are regular files. Directories, FIFOs, devices, sockets, symbolic links, and files over one MiB are rejected. Error output is neutralized so terminal control sequences and Unicode bidirectional override characters in paths or arguments cannot manipulate terminal output.

## Compile-time limits

Defaults are deliberately conservative:

```js
compileQuery(query, {
  maxParameters: 1000,
  maxSqlLength: 65536,
  maxFragmentDepth: 32
});
```

The caps protect against pathological generated queries, accidental unbounded loops, parameter-limit failures, and memory spikes. They can be narrowed for a service but cannot be raised beyond hard implementation maximums.

## Parameter policy

Strings, finite numbers, booleans, `null`, bigint values, valid `Date` objects, and byte arrays are accepted. These values fail closed by default:

- `undefined`
- `NaN`
- `Infinity` and `-Infinity`
- symbols
- functions
- arrays and objects
- invalid `Date` objects
- circular or otherwise unserializable objects

Explicit compile options exist for unusual drivers: `allowUndefined`, `allowNonFiniteNumbers`, `allowObjects`, `allowSymbols`, and `allowFunctions`. These are escape hatches, not recommendations. `allowObjects` still requires a bounded JSON-shaped object or array.

## Limitations

- sqlcage is not a full SQL parser and does not validate database-specific grammar.
- The auditor is heuristic and intentionally conservative. Clean output is not a proof of safety.
- sqlcage does not inspect database permissions or replace least-privilege accounts.
- It cannot detect unsafe SQL assembled outside its fragment system.
- Identifier helpers quote identifiers for a selected dialect. Reuse fragments with the dialect for which they were created.
- MySQL does not support standard `NULLS FIRST` or `NULLS LAST` syntax, so those clauses are rejected for the MySQL dialect instead of being emulated silently.
- sqlcage does not connect to a database and cannot know whether an allowlisted table or column exists in the live database.
- Query results are frozen. Copy the parameter array if a driver or test harness requires a mutable array.

## Security

Read `SECURITY.md` before reporting or triaging a vulnerability. Do not open a public issue with a working exploit for an unpatched flaw.

## Contributing

Read `CONTRIBUTING.md` and `docs/GOOD_FIRST_ISSUES.md`. The project has no runtime or development dependencies. Verification uses the Node.js test runner and scripts already present in the repository.

## License

MIT. See `LICENSE`.
