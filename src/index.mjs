const SQL_FRAGMENT_BRAND = Symbol('SqlFragment');
const PARAMETER_PART = Symbol('sqlcage.parameterPart');
const fragmentData = new WeakMap();

export const SQLCAGE_VERSION = '1.0.0';
export const DIALECTS = Object.freeze(['postgres', 'mysql', 'sqlite']);

export const CODE = Object.freeze({
  NOT_TAGGED_TEMPLATE: 'SQLCAGE_NOT_TAGGED_TEMPLATE',
  INVALID_FRAGMENT: 'SQLCAGE_INVALID_FRAGMENT',
  INVALID_DIALECT: 'SQLCAGE_INVALID_DIALECT',
  INVALID_OPTIONS: 'SQLCAGE_INVALID_OPTIONS',
  INVALID_PARAMETER: 'SQLCAGE_INVALID_PARAMETER',
  MAX_PARAMETERS: 'SQLCAGE_MAX_PARAMETERS',
  MAX_SQL_LENGTH: 'SQLCAGE_MAX_SQL_LENGTH',
  MAX_FRAGMENT_DEPTH: 'SQLCAGE_MAX_FRAGMENT_DEPTH',
  INVALID_IDENTIFIER: 'SQLCAGE_INVALID_IDENTIFIER',
  INVALID_SCHEMA: 'SQLCAGE_INVALID_SCHEMA',
  UNKNOWN_TABLE: 'SQLCAGE_UNKNOWN_TABLE',
  UNKNOWN_COLUMN: 'SQLCAGE_UNKNOWN_COLUMN',
  EMPTY_COLUMN_LIST: 'SQLCAGE_EMPTY_COLUMN_LIST',
  INVALID_ORDER_BY: 'SQLCAGE_INVALID_ORDER_BY',
  EMPTY_ORDER_BY: 'SQLCAGE_EMPTY_ORDER_BY',
  INVALID_LIMIT_OFFSET: 'SQLCAGE_INVALID_LIMIT_OFFSET',
  EMPTY_IN_LIST: 'SQLCAGE_EMPTY_IN_LIST',
  EMPTY_VALUES: 'SQLCAGE_EMPTY_VALUES',
  EMPTY_SET: 'SQLCAGE_EMPTY_SET',
  EMPTY_CONDITION_LIST: 'SQLCAGE_EMPTY_CONDITION_LIST',
  INVALID_JOIN_SEPARATOR: 'SQLCAGE_INVALID_JOIN_SEPARATOR',
  INVALID_LIKE_PATTERN: 'SQLCAGE_INVALID_LIKE_PATTERN',
  INVALID_INPUT: 'SQLCAGE_INVALID_INPUT',
  MULTI_STATEMENT: 'SQLCAGE_MULTI_STATEMENT',
  DANGEROUS_KEYWORD: 'SQLCAGE_DANGEROUS_KEYWORD',
  COMMENT_TOKEN: 'SQLCAGE_COMMENT_TOKEN',
  UNBALANCED_QUOTE: 'SQLCAGE_UNBALANCED_QUOTE',
  NUL_BYTE: 'SQLCAGE_NUL_BYTE'
});

const DEFAULT_MAX_PARAMETERS = 1_000;
const DEFAULT_MAX_SQL_LENGTH = 65_536;
const DEFAULT_MAX_FRAGMENT_DEPTH = 32;
const DEFAULT_MAX_LIMIT = 1_000;
const MAX_ALLOWED_PARAMETERS_CAP = 65_535;
const MAX_ALLOWED_SQL_LENGTH_CAP = 16_777_216;
const MAX_ALLOWED_FRAGMENT_DEPTH_CAP = 128;
const MAX_SCHEMA_TABLES = 256;
const MAX_SCHEMA_COLUMNS = 256;
const MAX_ORDER_CLAUSES = 16;
const MAX_SET_COLUMNS = 128;
const MAX_VALUES_ROWS = 1_000;
const MAX_AUDIT_FINDINGS = 256;

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const FORBIDDEN_IDENTIFIER_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const LIKE_ESCAPE_CHARS = new Set(['\\', '!', '@', '#', '^', '~', '|']);
const DANGEROUS_SINGLE_KEYWORDS = new Set([
  'DROP',
  'TRUNCATE',
  'ALTER',
  'GRANT',
  'REVOKE',
  'XP_CMDSHELL',
  'LOAD_FILE'
]);

export class SqlCageError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'SqlCageError';
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

function fail(code, message, details) {
  throw new SqlCageError(code, message, details);
}

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, name) {
  if (!isPlainObject(value)) {
    fail(CODE.INVALID_OPTIONS, name + ' must be a plain object');
  }
}

function normalizeDialect(dialect) {
  const value = dialect === undefined ? 'postgres' : dialect;
  if (typeof value !== 'string' || !DIALECTS.includes(value)) {
    fail(CODE.INVALID_DIALECT, 'dialect must be one of postgres, mysql, or sqlite');
  }
  return value;
}

function normalizeDialectArgument(dialectOrOptions) {
  if (isPlainObject(dialectOrOptions)) {
    return normalizeDialect(dialectOrOptions.dialect);
  }
  return normalizeDialect(dialectOrOptions);
}

function positiveIntegerOption(options, key, fallback, maximum) {
  const value = options[key] === undefined ? fallback : options[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    fail(CODE.INVALID_OPTIONS, key + ' must be a safe positive integer no greater than ' + maximum);
  }
  return value;
}

function booleanOption(options, key) {
  return options[key] === true;
}

function normalizeCompileOptions(options, base) {
  if (options === undefined || options === null) options = {};
  assertPlainObject(options, 'compile options');
  const merged = base === undefined ? {} : { ...base };
  for (const key of Object.keys(options)) {
    if (options[key] !== undefined) merged[key] = options[key];
  }
  return Object.freeze({
    dialect: normalizeDialect(merged.dialect),
    maxParameters: positiveIntegerOption(merged, 'maxParameters', DEFAULT_MAX_PARAMETERS, MAX_ALLOWED_PARAMETERS_CAP),
    maxSqlLength: positiveIntegerOption(merged, 'maxSqlLength', DEFAULT_MAX_SQL_LENGTH, MAX_ALLOWED_SQL_LENGTH_CAP),
    maxFragmentDepth: positiveIntegerOption(merged, 'maxFragmentDepth', DEFAULT_MAX_FRAGMENT_DEPTH, MAX_ALLOWED_FRAGMENT_DEPTH_CAP),
    allowUndefined: booleanOption(merged, 'allowUndefined'),
    allowNonFiniteNumbers: booleanOption(merged, 'allowNonFiniteNumbers'),
    allowObjects: booleanOption(merged, 'allowObjects'),
    allowSymbols: booleanOption(merged, 'allowSymbols'),
    allowFunctions: booleanOption(merged, 'allowFunctions')
  });
}

function createFragment(strings, values) {
  if (!Array.isArray(strings) || !Array.isArray(values) || strings.length !== values.length + 1) {
    fail(CODE.INVALID_FRAGMENT, 'a SQL fragment requires strings.length to equal values.length + 1');
  }
  for (let index = 0; index < strings.length; index += 1) {
    if (typeof strings[index] !== 'string') {
      fail(CODE.INVALID_FRAGMENT, 'SQL fragment template strings must be strings');
    }
  }
  const fragment = Object.create(null);
  Object.defineProperty(fragment, SQL_FRAGMENT_BRAND, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false
  });
  fragmentData.set(fragment, Object.freeze({
    strings: Object.freeze(strings.slice()),
    values: Object.freeze(values.slice())
  }));
  return Object.freeze(fragment);
}

function assertTaggedTemplate(strings, values) {
  if (
    !Array.isArray(strings) ||
    !Object.isFrozen(strings) ||
    !Array.isArray(strings.raw) ||
    !Object.isFrozen(strings.raw) ||
    strings.length !== values.length + 1 ||
    strings.raw.length !== strings.length
  ) {
    fail(
      CODE.NOT_TAGGED_TEMPLATE,
      'sql must be used as a tagged template, for example sql`SELECT * FROM users WHERE id = ${id}`'
    );
  }
  for (let index = 0; index < strings.length; index += 1) {
    if (typeof strings[index] !== 'string' || typeof strings.raw[index] !== 'string') {
      fail(CODE.NOT_TAGGED_TEMPLATE, 'sql template strings and raw strings must be strings');
    }
  }
}

export function sql(strings, ...values) {
  assertTaggedTemplate(strings, values);
  return createFragment(Array.from(strings), values);
}

export function isSqlFragment(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    value[SQL_FRAGMENT_BRAND] === true &&
    fragmentData.has(value)
  );
}

function assertFragment(value, name) {
  if (!isSqlFragment(value)) {
    fail(CODE.INVALID_FRAGMENT, name + ' must be a SQL fragment created by the sql tagged template or a sqlcage helper');
  }
}

function dynamicPart(value) {
  if (typeof value !== 'string') return value;
  return Object.freeze({ [PARAMETER_PART]: true, value });
}

function assembleParts(parts) {
  const strings = [];
  const values = [];
  let current = '';
  for (const part of parts) {
    if (typeof part === 'string') {
      current += part;
    } else {
      strings.push(current);
      values.push(
        typeof part === 'object' && part !== null && part[PARAMETER_PART] === true
          ? part.value
          : part
      );
      current = '';
    }
  }
  strings.push(current);
  return createFragment(strings, values);
}

function staticFragment(text) {
  return createFragment([text], []);
}

function jsonSerializable(value, depth) {
  if (depth > 32) return false;
  if (value === null) return true;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return true;
  if (type === 'number') return Number.isFinite(value);
  if (type !== 'object') return false;
  if (value instanceof Date) return Number.isFinite(value.getTime());
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!jsonSerializable(item, depth + 1)) return false;
    }
    return true;
  }
  if (!isPlainObject(value)) return false;
  for (const key of Object.keys(value)) {
    if (!jsonSerializable(value[key], depth + 1)) return false;
  }
  return true;
}

function validateParameter(value, options, position) {
  if (value === undefined && !options.allowUndefined) {
    fail(CODE.INVALID_PARAMETER, 'parameter ' + position + ' is undefined; pass null explicitly or set allowUndefined');
  }
  const type = typeof value;
  if (type === 'number' && !Number.isFinite(value) && !options.allowNonFiniteNumbers) {
    fail(CODE.INVALID_PARAMETER, 'parameter ' + position + ' must be a finite number');
  }
  if (type === 'symbol' && !options.allowSymbols) {
    fail(CODE.INVALID_PARAMETER, 'parameter ' + position + ' must not be a symbol');
  }
  if (type === 'function' && !options.allowFunctions) {
    fail(CODE.INVALID_PARAMETER, 'parameter ' + position + ' must not be a function');
  }
  if (type === 'object' && value !== null) {
    if (value instanceof Date) {
      if (!Number.isFinite(value.getTime())) {
        fail(CODE.INVALID_PARAMETER, 'parameter ' + position + ' must not be an invalid Date');
      }
    } else if (value instanceof Uint8Array) {
      if (!(value.buffer instanceof ArrayBuffer)) {
        fail(CODE.INVALID_PARAMETER, 'parameter ' + position + ' must be a valid byte array');
      }
    } else if (!options.allowObjects) {
      fail(
        CODE.INVALID_PARAMETER,
        'parameter ' + position + ' is an object or array; set allowObjects only when your driver serializes it'
      );
    } else if (!jsonSerializable(value, 0)) {
      fail(CODE.INVALID_PARAMETER, 'parameter ' + position + ' is not a safely serializable object');
    }
  }
  return value;
}

function compileFragment(fragment, options) {
  assertFragment(fragment, 'query');
  const parts = [];
  const values = [];
  let sqlLength = 0;

  function appendSql(text) {
    sqlLength += text.length;
    if (sqlLength > options.maxSqlLength) {
      fail(CODE.MAX_SQL_LENGTH, 'compiled SQL length exceeds maxSqlLength (' + options.maxSqlLength + ')');
    }
    parts.push(text);
  }

  function appendParameter(value) {
    if (values.length >= options.maxParameters) {
      fail(CODE.MAX_PARAMETERS, 'parameter count exceeds maxParameters (' + options.maxParameters + ')');
    }
    values.push(validateParameter(value, options, values.length + 1));
    appendSql(options.dialect === 'postgres' ? '$' + values.length : '?');
  }

  const stack = [{ type: 'fragment', fragment, depth: 0 }];
  while (stack.length > 0) {
    const event = stack.pop();
    if (event.type === 'text') {
      appendSql(event.text);
      continue;
    }
    if (event.type === 'parameter') {
      appendParameter(event.value);
      continue;
    }
    if (event.depth > options.maxFragmentDepth) {
      fail(CODE.MAX_FRAGMENT_DEPTH, 'SQL fragment nesting exceeds maxFragmentDepth (' + options.maxFragmentDepth + ')');
    }
    const data = fragmentData.get(event.fragment);
    const sequence = [{ type: 'text', text: data.strings[0] }];
    for (let index = 0; index < data.values.length; index += 1) {
      const value = data.values[index];
      sequence.push(isSqlFragment(value)
        ? { type: 'fragment', fragment: value, depth: event.depth + 1 }
        : { type: 'parameter', value });
      sequence.push({ type: 'text', text: data.strings[index + 1] });
    }
    for (let index = sequence.length - 1; index >= 0; index -= 1) {
      stack.push(sequence[index]);
    }
  }

  const compiled = parts.join('');
  const boundValues = Object.freeze(values.slice());
  if (options.dialect === 'postgres') {
    return Object.freeze({ text: compiled, values: boundValues });
  }
  if (options.dialect === 'mysql') {
    return Object.freeze({ sql: compiled, values: boundValues });
  }
  return Object.freeze({ sql: compiled, params: boundValues });
}

export function compileQuery(fragment, options) {
  return compileFragment(fragment, normalizeCompileOptions(options));
}

export function createSqlCage(options) {
  const baseOptions = normalizeCompileOptions(options);
  const cage = {
    sql,
    dialect: baseOptions.dialect,
    compile(query, compileOptions) {
      return compileFragment(query, normalizeCompileOptions(compileOptions, baseOptions));
    },
    compileQuery(query, compileOptions) {
      return compileFragment(query, normalizeCompileOptions(compileOptions, baseOptions));
    },
    quoteIdentifier(name, quoteOptions) {
      return quoteIdentifier(name, quoteOptions === undefined ? baseOptions.dialect : quoteOptions);
    },
    schema(schemaSpec, schemaOptions) {
      const merged = schemaOptions === undefined ? { dialect: baseOptions.dialect } : { ...schemaOptions };
      if (merged.dialect === undefined) merged.dialect = baseOptions.dialect;
      return createSchemaGuard(schemaSpec, merged);
    },
    options: baseOptions
  };
  return Object.freeze(cage);
}

export function isValidIdentifier(name) {
  return (
    typeof name === 'string' &&
    IDENTIFIER_PATTERN.test(name) &&
    !FORBIDDEN_IDENTIFIER_NAMES.has(name.toLowerCase())
  );
}

function assertIdentifier(name, role) {
  if (!isValidIdentifier(name)) {
    fail(
      CODE.INVALID_IDENTIFIER,
      role + ' must be an ASCII SQL identifier matching [A-Za-z_][A-Za-z0-9_]{0,62} and must not be a prototype-pollution name'
    );
  }
  return name;
}

export function quoteIdentifier(name, dialectOrOptions) {
  const dialect = normalizeDialectArgument(dialectOrOptions);
  assertIdentifier(name, 'identifier');
  return dialect === 'mysql' ? '`' + name + '`' : '"' + name + '"';
}

function qualifiedIdentifier(column, dialect, table) {
  const quotedColumn = quoteIdentifier(column, dialect);
  if (table === undefined) return quotedColumn;
  return quoteIdentifier(table, dialect) + '.' + quotedColumn;
}

function normalizeAllowedColumns(allowedColumns) {
  if (!Array.isArray(allowedColumns) && !(allowedColumns instanceof Set)) {
    fail(CODE.INVALID_SCHEMA, 'allowedColumns must be an array or Set of SQL identifiers');
  }
  const result = new Set();
  for (const column of allowedColumns) {
    assertIdentifier(column, 'allowed column');
    result.add(column);
  }
  return result;
}

function normalizeColumnList(columns, emptyCode) {
  if (!Array.isArray(columns)) {
    fail(emptyCode, 'columns must be an array of SQL identifiers');
  }
  if (columns.length === 0) {
    fail(emptyCode, 'columns must not be empty');
  }
  return columns;
}

function positiveCap(value, fallback, maximum, name) {
  const candidate = value === undefined ? fallback : value;
  if (typeof candidate !== 'number' || !Number.isSafeInteger(candidate) || candidate < 1 || candidate > maximum) {
    fail(CODE.INVALID_OPTIONS, name + ' must be a safe positive integer no greater than ' + maximum);
  }
  return candidate;
}

function optionalPositiveCap(value, maximum, name) {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    fail(CODE.INVALID_OPTIONS, name + ' must be a safe positive integer no greater than ' + maximum);
  }
  return value;
}

export function safeColumns(columns, allowedColumns, options) {
  if (options === undefined || options === null) options = {};
  assertPlainObject(options, 'safeColumns options');
  const dialect = normalizeDialect(options.dialect);
  const table = options.table === undefined ? undefined : assertIdentifier(options.table, 'table');
  const allowed = normalizeAllowedColumns(allowedColumns);
  const input = normalizeColumnList(columns, CODE.EMPTY_COLUMN_LIST);
  const maxColumns = positiveCap(options.maxColumns, MAX_SCHEMA_COLUMNS, 1_024, 'maxColumns');
  const seen = new Set();
  const output = [];
  for (const column of input) {
    assertIdentifier(column, 'column');
    if (!allowed.has(column)) {
      fail(CODE.UNKNOWN_COLUMN, 'column is not in the allowlist', { column });
    }
    if (!seen.has(column)) {
      seen.add(column);
      output.push(qualifiedIdentifier(column, dialect, table));
      if (output.length > maxColumns) {
        fail(CODE.INVALID_OPTIONS, 'column count exceeds maxColumns (' + maxColumns + ')');
      }
    }
  }
  return staticFragment(output.join(', '));
}

function normalizeOrderDirection(direction, fromString) {
  if (direction === undefined) return 'ASC';
  const value = fromString ? String(direction).toUpperCase() : direction;
  if (value !== 'ASC' && value !== 'DESC') {
    fail(CODE.INVALID_ORDER_BY, 'ORDER BY direction must be ASC or DESC');
  }
  return value;
}

function normalizeOrderNulls(nulls, fromString) {
  if (nulls === undefined) return undefined;
  const value = fromString ? String(nulls).toUpperCase() : nulls;
  if (value !== 'FIRST' && value !== 'LAST') {
    fail(CODE.INVALID_ORDER_BY, 'ORDER BY nulls must be FIRST or LAST');
  }
  return value;
}

function parseOrderString(input) {
  const clauses = [];
  const pieces = input.split(',');
  for (const rawPiece of pieces) {
    const piece = rawPiece.trim();
    if (piece.length === 0) {
      fail(CODE.INVALID_ORDER_BY, 'ORDER BY string must not contain empty clauses');
    }
    const parts = piece.split(':').map((part) => part.trim());
    if (parts.length < 1 || parts.length > 3 || parts[0].length === 0) {
      fail(CODE.INVALID_ORDER_BY, 'ORDER BY string clauses must use column[:asc|desc[:nulls-first|nulls-last]]');
    }
    let nulls;
    if (parts.length === 3) {
      const marker = parts[2].replace(/^nulls-/i, '');
      nulls = normalizeOrderNulls(marker, true);
    }
    clauses.push({
      column: parts[0],
      direction: normalizeOrderDirection(parts[1], true),
      nulls
    });
  }
  return clauses;
}

function normalizeOrderClauses(clauses) {
  if (typeof clauses === 'string') {
    return parseOrderString(clauses);
  }
  if (!Array.isArray(clauses)) {
    fail(CODE.INVALID_ORDER_BY, 'ORDER BY clauses must be an array or a safe comma-separated string');
  }
  return clauses.map((clause) => {
    if (!isPlainObject(clause)) {
      fail(CODE.INVALID_ORDER_BY, 'each ORDER BY clause must be a plain object');
    }
    return {
      column: clause.column,
      direction: normalizeOrderDirection(clause.direction, false),
      nulls: normalizeOrderNulls(clause.nulls, false)
    };
  });
}

export function safeOrderBy(clauses, allowedColumns, options) {
  if (options === undefined || options === null) options = {};
  assertPlainObject(options, 'safeOrderBy options');
  const dialect = normalizeDialect(options.dialect);
  const table = options.table === undefined ? undefined : assertIdentifier(options.table, 'table');
  const allowed = normalizeAllowedColumns(allowedColumns);
  const parsed = normalizeOrderClauses(clauses);
  if (parsed.length === 0) {
    fail(CODE.EMPTY_ORDER_BY, 'ORDER BY clauses must not be empty');
  }
  const maxClauses = positiveCap(options.maxClauses, MAX_ORDER_CLAUSES, 64, 'maxClauses');
  if (parsed.length > maxClauses) {
    fail(CODE.INVALID_ORDER_BY, 'ORDER BY clause count exceeds maxClauses (' + maxClauses + ')');
  }
  const seen = new Set();
  const terms = [];
  for (const clause of parsed) {
    assertIdentifier(clause.column, 'ORDER BY column');
    if (!allowed.has(clause.column)) {
      fail(CODE.UNKNOWN_COLUMN, 'ORDER BY column is not sortable', { column: clause.column });
    }
    if (seen.has(clause.column)) {
      fail(CODE.INVALID_ORDER_BY, 'ORDER BY columns must not repeat', { column: clause.column });
    }
    seen.add(clause.column);
    if (clause.nulls !== undefined && dialect === 'mysql') {
      fail(CODE.INVALID_ORDER_BY, 'MySQL does not support ORDER BY NULLS FIRST or NULLS LAST syntax');
    }
    let term = qualifiedIdentifier(clause.column, dialect, table) + ' ' + clause.direction;
    if (clause.nulls !== undefined) term += ' NULLS ' + clause.nulls;
    terms.push(term);
  }
  return staticFragment('ORDER BY ' + terms.join(', '));
}

function normalizeLimitOffset(input, options) {
  if (!isPlainObject(input)) {
    fail(CODE.INVALID_LIMIT_OFFSET, 'limitOffset input must be a plain object');
  }
  const inputMaxLimit = Object.prototype.hasOwnProperty.call(input, 'maxLimit') ? input.maxLimit : undefined;
  const inputLimit = Object.prototype.hasOwnProperty.call(input, 'limit') ? input.limit : undefined;
  const inputOffset = Object.prototype.hasOwnProperty.call(input, 'offset') ? input.offset : undefined;
  let maxLimitCandidate = inputMaxLimit === undefined ? DEFAULT_MAX_LIMIT : inputMaxLimit;
  if (typeof maxLimitCandidate !== 'number' || !Number.isSafeInteger(maxLimitCandidate) || maxLimitCandidate < 1) {
    fail(CODE.INVALID_LIMIT_OFFSET, 'maxLimit must be a positive safe integer');
  }
  if (options.maxLimit !== undefined) {
    if (typeof options.maxLimit !== 'number' || !Number.isSafeInteger(options.maxLimit) || options.maxLimit < 1) {
      fail(CODE.INVALID_LIMIT_OFFSET, 'configured maxLimit must be a positive safe integer');
    }
    maxLimitCandidate = Math.min(maxLimitCandidate, options.maxLimit);
  }
  if (typeof inputLimit !== 'number' || !Number.isSafeInteger(inputLimit) || inputLimit < 1 || inputLimit > maxLimitCandidate) {
    fail(CODE.INVALID_LIMIT_OFFSET, 'limit must be an integer between 1 and maxLimit');
  }
  const offset = inputOffset === undefined ? 0 : inputOffset;
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) {
    fail(CODE.INVALID_LIMIT_OFFSET, 'offset must be a non-negative safe integer');
  }
  return Object.freeze({ limit: inputLimit, offset, maxLimit: maxLimitCandidate });
}

export function safeLimitOffset(input, options) {
  if (options === undefined || options === null) options = {};
  assertPlainObject(options, 'safeLimitOffset options');
  const normalized = normalizeLimitOffset(input, options);
  return assembleParts(['LIMIT ', dynamicPart(normalized.limit), ' OFFSET ', dynamicPart(normalized.offset)]);
}

function normalizeSchemaTableSpec(tableName, tableSpec) {
  let columnsInput;
  let sortableInput;
  let sortableWasProvided = false;
  if (Array.isArray(tableSpec)) {
    columnsInput = tableSpec;
  } else if (isPlainObject(tableSpec)) {
    if (Object.prototype.hasOwnProperty.call(tableSpec, 'columns')) {
      columnsInput = tableSpec.columns;
    }
    if (Object.prototype.hasOwnProperty.call(tableSpec, 'sortable')) {
      sortableInput = tableSpec.sortable;
      sortableWasProvided = true;
    } else if (Object.prototype.hasOwnProperty.call(tableSpec, 'sortableColumns')) {
      sortableInput = tableSpec.sortableColumns;
      sortableWasProvided = true;
    }
  } else {
    fail(CODE.INVALID_SCHEMA, 'schema table ' + tableName + ' must be a column array or an object with columns');
  }
  if (!Array.isArray(columnsInput) || columnsInput.length === 0) {
    fail(CODE.INVALID_SCHEMA, 'schema table ' + tableName + ' must declare at least one column');
  }
  const columns = [];
  const columnSet = new Set();
  for (const column of columnsInput) {
    assertIdentifier(column, 'schema column');
    if (columnSet.has(column)) {
      fail(CODE.INVALID_SCHEMA, 'schema table ' + tableName + ' repeats column ' + column);
    }
    columnSet.add(column);
    columns.push(column);
  }
  let sortable;
  if (!sortableWasProvided) {
    sortable = columns.slice();
  } else {
    if (!Array.isArray(sortableInput)) {
      fail(CODE.INVALID_SCHEMA, 'schema table ' + tableName + ' sortable must be an array');
    }
    sortable = [];
    const sortableSet = new Set();
    for (const column of sortableInput) {
      assertIdentifier(column, 'sortable column');
      if (!columnSet.has(column)) {
        fail(CODE.INVALID_SCHEMA, 'schema table ' + tableName + ' sortable column ' + column + ' is not a declared column');
      }
      if (sortableSet.has(column)) {
        fail(CODE.INVALID_SCHEMA, 'schema table ' + tableName + ' repeats sortable column ' + column);
      }
      sortableSet.add(column);
      sortable.push(column);
    }
  }
  return Object.freeze({
    columns: Object.freeze(columns),
    sortable: Object.freeze(sortable)
  });
}

export function createSchemaGuard(schemaSpec, options) {
  if (options === undefined || options === null) options = {};
  assertPlainObject(options, 'schema guard options');
  const dialect = normalizeDialect(options.dialect);
  if (!isPlainObject(schemaSpec)) {
    fail(CODE.INVALID_SCHEMA, 'schemaSpec must be a plain object mapping tables to columns');
  }
  const tableNames = Object.keys(schemaSpec);
  if (tableNames.length === 0) {
    fail(CODE.INVALID_SCHEMA, 'schemaSpec must declare at least one table');
  }
  const maxTables = positiveCap(options.maxTables, MAX_SCHEMA_TABLES, 4_096, 'maxTables');
  if (tableNames.length > maxTables) {
    fail(CODE.INVALID_SCHEMA, 'schema table count exceeds maxTables (' + maxTables + ')');
  }
  const maxColumns = positiveCap(options.maxColumns, MAX_SCHEMA_COLUMNS, 1_024, 'maxColumns');
  const maxClauses = positiveCap(options.maxClauses, MAX_ORDER_CLAUSES, 64, 'maxClauses');
  const configuredMaxLimit = optionalPositiveCap(options.maxLimit, Number.MAX_SAFE_INTEGER, 'maxLimit');
  const normalized = Object.create(null);
  for (const tableName of tableNames) {
    assertIdentifier(tableName, 'schema table');
    const tableInfo = normalizeSchemaTableSpec(tableName, schemaSpec[tableName]);
    if (tableInfo.columns.length > maxColumns) {
      fail(CODE.INVALID_SCHEMA, 'schema table ' + tableName + ' exceeds maxColumns (' + maxColumns + ')');
    }
    normalized[tableName] = tableInfo;
  }
  Object.freeze(normalized);

  function assertKnownTable(name) {
    assertIdentifier(name, 'table');
    if (!Object.prototype.hasOwnProperty.call(normalized, name)) {
      fail(CODE.UNKNOWN_TABLE, 'table is not in the schema allowlist', { table: name });
    }
    return normalized[name];
  }

  const guard = {
    dialect,
    tables: Object.freeze(tableNames.slice()),
    table(name) {
      assertKnownTable(name);
      return staticFragment(quoteIdentifier(name, dialect));
    },
    column(tableName, columnName) {
      const tableInfo = assertKnownTable(tableName);
      assertIdentifier(columnName, 'column');
      if (!tableInfo.columns.includes(columnName)) {
        fail(CODE.UNKNOWN_COLUMN, 'column is not in the table allowlist', { table: tableName, column: columnName });
      }
      return staticFragment(qualifiedIdentifier(columnName, dialect, tableName));
    },
    columns(tableName, columns) {
      const tableInfo = assertKnownTable(tableName);
      return safeColumns(columns, tableInfo.columns, {
        dialect,
        table: tableName,
        maxColumns
      });
    },
    orderBy(tableName, clauses) {
      const tableInfo = assertKnownTable(tableName);
      return safeOrderBy(clauses, tableInfo.sortable, {
        dialect,
        table: tableName,
        maxClauses
      });
    },
    limitOffset(input) {
      return safeLimitOffset(input, { maxLimit: configuredMaxLimit });
    },
    hasTable(name) {
      return typeof name === 'string' && Object.prototype.hasOwnProperty.call(normalized, name);
    },
    hasColumn(tableName, columnName) {
      return (
        typeof tableName === 'string' &&
        Object.prototype.hasOwnProperty.call(normalized, tableName) &&
        normalized[tableName].columns.includes(columnName)
      );
    },
    columnsFor(tableName) {
      return assertKnownTable(tableName).columns;
    },
    sortableFor(tableName) {
      return assertKnownTable(tableName).sortable;
    }
  };
  return Object.freeze(guard);
}

function validateJoinSeparator(separator) {
  if (typeof separator !== 'string' || separator.length === 0 || separator.length > 32) {
    fail(CODE.INVALID_JOIN_SEPARATOR, 'join separator must be a non-empty string of at most 32 characters');
  }
  if (/[\u0000-\u001f\u007f]/.test(separator)) {
    fail(CODE.INVALID_JOIN_SEPARATOR, 'join separator must not contain control characters');
  }
  if (/^\s*,\s*$/.test(separator)) return separator;
  if (/^\s+(AND|OR)\s+$/i.test(separator)) return separator;
  fail(CODE.INVALID_JOIN_SEPARATOR, 'join separator must be a comma or a whitespace-separated AND/OR operator');
}

export function sqlJoin(parts, separator) {
  if (!Array.isArray(parts)) {
    fail(CODE.INVALID_INPUT, 'sqlJoin parts must be an array of SQL fragments');
  }
  const joiner = validateJoinSeparator(separator === undefined ? ', ' : separator);
  for (const part of parts) assertFragment(part, 'sqlJoin part');
  if (parts.length === 0) return staticFragment('');
  const assembled = [];
  for (let index = 0; index < parts.length; index += 1) {
    if (index > 0) assembled.push(joiner);
    assembled.push(parts[index]);
  }
  return assembleParts(assembled);
}

function wrapConditions(parts, joiner) {
  if (!Array.isArray(parts) || parts.length === 0) {
    fail(CODE.EMPTY_CONDITION_LIST, 'condition list must not be empty');
  }
  for (const part of parts) assertFragment(part, 'condition');
  return sqlJoin(parts.map((part) => assembleParts(['(', part, ')'])), joiner);
}

export function sqlAnd(parts) {
  return wrapConditions(parts, ' AND ');
}

export function sqlOr(parts) {
  return wrapConditions(parts, ' OR ');
}

export function sqlIn(columnOrValues, valuesOrOptions, maybeOptions) {
  let column;
  let values;
  let options;
  if (Array.isArray(valuesOrOptions)) {
    column = columnOrValues;
    values = valuesOrOptions;
    options = maybeOptions === undefined ? {} : maybeOptions;
  } else {
    values = columnOrValues;
    options = valuesOrOptions === undefined ? {} : valuesOrOptions;
  }
  if (!Array.isArray(values)) {
    fail(CODE.INVALID_INPUT, 'sqlIn values must be an array');
  }
  if (options === null || !isPlainObject(options)) {
    fail(CODE.INVALID_OPTIONS, 'sqlIn options must be a plain object');
  }
  const onEmpty = options.onEmpty === undefined ? 'throw' : options.onEmpty;
  if (onEmpty !== 'throw' && onEmpty !== 'false') {
    fail(CODE.INVALID_OPTIONS, "sqlIn onEmpty must be 'throw' or 'false'");
  }
  const dialect = normalizeDialect(options.dialect);
  let columnFragment;
  if (column !== undefined) {
    columnFragment = columnToFragment(column, dialect);
  }
  if (values.length === 0) {
    if (onEmpty === 'false') {
      return staticFragment(columnFragment === undefined ? 'IN (SELECT NULL WHERE 1 = 0)' : '1 = 0');
    }
    fail(CODE.EMPTY_IN_LIST, 'IN lists must not be empty');
  }
  const maxParameters = positiveCap(options.maxParameters, DEFAULT_MAX_PARAMETERS, MAX_ALLOWED_PARAMETERS_CAP, 'maxParameters');
  if (values.length > maxParameters) {
    fail(CODE.MAX_PARAMETERS, 'IN list item count exceeds maxParameters (' + maxParameters + ')');
  }
  const parts = [];
  if (columnFragment !== undefined) {
    parts.push(columnFragment, ' IN (');
  } else {
    parts.push('IN (');
  }
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0) parts.push(', ');
    parts.push(dynamicPart(values[index]));
  }
  parts.push(')');
  return assembleParts(parts);
}

function normalizeValuesRows(rows, options) {
  if (!Array.isArray(rows) || rows.length === 0) {
    fail(CODE.EMPTY_VALUES, 'VALUES rows must be a non-empty array');
  }
  const maxRows = positiveCap(options.maxRows, MAX_VALUES_ROWS, 10_000, 'maxRows');
  if (rows.length > maxRows) {
    fail(CODE.EMPTY_VALUES, 'VALUES row count exceeds maxRows (' + maxRows + ')');
  }
  const maxParameters = positiveCap(options.maxParameters, DEFAULT_MAX_PARAMETERS, MAX_ALLOWED_PARAMETERS_CAP, 'maxParameters');
  const firstIsArray = Array.isArray(rows[0]);
  const firstIsObject = isPlainObject(rows[0]);
  if (!firstIsArray && !firstIsObject) {
    fail(CODE.EMPTY_VALUES, 'VALUES rows must be arrays or plain objects');
  }
  let columns;
  let width;
  if (firstIsArray) {
    width = rows[0].length;
    if (width === 0) fail(CODE.EMPTY_VALUES, 'VALUES rows must not be empty');
    for (const row of rows) {
      if (!Array.isArray(row) || row.length !== width) {
        fail(CODE.EMPTY_VALUES, 'all VALUES array rows must have the same non-zero width');
      }
    }
    if (width * rows.length > maxParameters) {
      fail(CODE.MAX_PARAMETERS, 'VALUES parameter count exceeds maxParameters (' + maxParameters + ')');
    }
    return Object.freeze({ rows, columns: undefined, width });
  }
  columns = options.columns === undefined ? Object.keys(rows[0]) : options.columns;
  if (!Array.isArray(columns) || columns.length === 0) {
    fail(CODE.EMPTY_VALUES, 'VALUES object rows must have at least one column');
  }
  const seenColumns = new Set();
  for (const column of columns) {
    assertIdentifier(column, 'VALUES column');
    if (seenColumns.has(column)) fail(CODE.EMPTY_VALUES, 'VALUES columns must not repeat');
    seenColumns.add(column);
  }
  if (columns.length * rows.length > maxParameters) {
    fail(CODE.MAX_PARAMETERS, 'VALUES parameter count exceeds maxParameters (' + maxParameters + ')');
  }
  for (const row of rows) {
    if (!isPlainObject(row)) {
      fail(CODE.EMPTY_VALUES, 'all VALUES object rows must be plain objects');
    }
    const keys = Object.keys(row);
    if (keys.length !== columns.length) {
      fail(CODE.EMPTY_VALUES, 'all VALUES object rows must exactly match the column list');
    }
    for (const key of keys) {
      if (!seenColumns.has(key)) {
        fail(CODE.EMPTY_VALUES, 'VALUES object row contains a column outside the column list');
      }
    }
  }
  return Object.freeze({ rows, columns: Object.freeze(columns.slice()), width: columns.length });
}

export function sqlValues(rows, options) {
  if (options === undefined || options === null) options = {};
  assertPlainObject(options, 'sqlValues options');
  const normalized = normalizeValuesRows(rows, options);
  const parts = ['VALUES '];
  for (let rowIndex = 0; rowIndex < normalized.rows.length; rowIndex += 1) {
    if (rowIndex > 0) parts.push(', ');
    parts.push('(');
    const row = normalized.rows[rowIndex];
    for (let columnIndex = 0; columnIndex < normalized.width; columnIndex += 1) {
      if (columnIndex > 0) parts.push(', ');
      parts.push(dynamicPart(normalized.columns === undefined ? row[columnIndex] : row[normalized.columns[columnIndex]]));
    }
    parts.push(')');
  }
  return assembleParts(parts);
}

export function sqlSet(assignments, options) {
  if (options === undefined || options === null) options = {};
  assertPlainObject(options, 'sqlSet options');
  if (!isPlainObject(assignments)) {
    fail(CODE.EMPTY_SET, 'sqlSet assignments must be a plain object');
  }
  const dialect = normalizeDialect(options.dialect);
  const keys = Object.keys(assignments);
  if (keys.length === 0) {
    fail(CODE.EMPTY_SET, 'sqlSet assignments must not be empty');
  }
  const maxColumns = positiveCap(options.maxColumns, MAX_SET_COLUMNS, 1_024, 'maxColumns');
  if (keys.length > maxColumns) {
    fail(CODE.EMPTY_SET, 'sqlSet column count exceeds maxColumns (' + maxColumns + ')');
  }
  let allowed;
  if (options.allowedColumns !== undefined) allowed = normalizeAllowedColumns(options.allowedColumns);
  const parts = ['SET '];
  for (let index = 0; index < keys.length; index += 1) {
    const column = keys[index];
    assertIdentifier(column, 'SET column');
    if (allowed !== undefined && !allowed.has(column)) {
      fail(CODE.UNKNOWN_COLUMN, 'SET column is not in the allowlist', { column });
    }
    if (index > 0) parts.push(', ');
    parts.push(quoteIdentifier(column, dialect) + ' = ', dynamicPart(assignments[column]));
  }
  return assembleParts(parts);
}

function assertLikeEscapeChar(escapeChar) {
  if (typeof escapeChar !== 'string' || !LIKE_ESCAPE_CHARS.has(escapeChar)) {
    fail(CODE.INVALID_LIKE_PATTERN, 'LIKE escape character must be one of \\, !, @, #, ^, ~, or |');
  }
  return escapeChar;
}

export function escapeLikePattern(input, escapeChar) {
  const escape = assertLikeEscapeChar(escapeChar === undefined ? '\\' : escapeChar);
  if (typeof input !== 'string') {
    fail(CODE.INVALID_LIKE_PATTERN, 'LIKE input must be a string');
  }
  let escaped = '';
  for (const character of input) {
    if (character === escape || character === '%' || character === '_') {
      escaped += escape + character;
    } else {
      escaped += character;
    }
  }
  return Object.freeze({ pattern: escaped, escapeChar: escape });
}

function columnToFragment(column, dialect) {
  if (isSqlFragment(column)) return column;
  if (typeof column === 'string') {
    return staticFragment(quoteIdentifier(column, dialect));
  }
  fail(CODE.INVALID_IDENTIFIER, 'column must be a SQL identifier string or a schema-guard SQL fragment');
}

export function sqlLike(column, value, options) {
  if (options === undefined || options === null) options = {};
  assertPlainObject(options, 'sqlLike options');
  const dialect = normalizeDialect(options.dialect);
  const mode = options.mode === undefined ? 'contains' : options.mode;
  if (mode !== 'contains' && mode !== 'startsWith' && mode !== 'endsWith') {
    fail(CODE.INVALID_LIKE_PATTERN, 'sqlLike mode must be contains, startsWith, or endsWith');
  }
  if (typeof value !== 'string') {
    fail(CODE.INVALID_LIKE_PATTERN, 'sqlLike value must be a string');
  }
  const maxPatternLength = positiveCap(options.maxPatternLength, 1_024, 65_536, 'maxPatternLength');
  if (value.length > maxPatternLength) {
    fail(CODE.INVALID_LIKE_PATTERN, 'sqlLike value exceeds maxPatternLength (' + maxPatternLength + ')');
  }
  const escapeChar = options.escapeChar === undefined ? '\\' : options.escapeChar;
  const escaped = escapeLikePattern(value, escapeChar);
  let pattern = escaped.pattern;
  if (mode === 'contains') pattern = '%' + pattern + '%';
  if (mode === 'startsWith') pattern = pattern + '%';
  if (mode === 'endsWith') pattern = '%' + pattern;
  const columnFragment = columnToFragment(column, dialect);
  const escapeLiteral = dialect === 'mysql' && escaped.escapeChar === '\\' ? '\\\\' : escaped.escapeChar;
  return assembleParts([columnFragment, ' LIKE ', dynamicPart(pattern), " ESCAPE '" + escapeLiteral + "'"]);
}

function utf8Length(text) {
  let length = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) length += 1;
    else if (code < 0x800) length += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        length += 4;
        index += 1;
      } else {
        length += 3;
      }
    } else {
      length += 3;
    }
  }
  return length;
}

function isAsciiWhitespace(character) {
  return character === ' ' || character === '\t' || character === '\n' || character === '\r' || character === '\f' || character === '\v';
}

function isWordCharacter(character) {
  return (
    (character >= 'a' && character <= 'z') ||
    (character >= 'A' && character <= 'Z') ||
    (character >= '0' && character <= '9') ||
    character === '_'
  );
}

function dollarQuoteDelimiter(query, index) {
  if (query[index] !== '$') return undefined;
  let cursor = index + 1;
  if (query[cursor] === '$') return '$$';
  if (cursor >= query.length || !isWordCharacter(query[cursor]) || (query[cursor] >= '0' && query[cursor] <= '9')) return undefined;
  while (cursor < query.length && isWordCharacter(query[cursor])) cursor += 1;
  if (query[cursor] === '$') return query.slice(index, cursor + 1);
  return undefined;
}

export function auditSqlQuery(query, options) {
  if (typeof query !== 'string') {
    fail(CODE.INVALID_INPUT, 'auditSqlQuery input must be a string');
  }
  if (options === undefined || options === null) options = {};
  assertPlainObject(options, 'audit options');
  const dialect = normalizeDialect(options.dialect);
  const maxSqlLength = positiveCap(options.maxSqlLength, DEFAULT_MAX_SQL_LENGTH, MAX_ALLOWED_SQL_LENGTH_CAP, 'maxSqlLength');
  const stats = {
    length: query.length,
    bytes: utf8Length(query),
    semicolons: 0,
    statements: 0,
    comments: 0,
    dangerousKeywords: 0,
    nulBytes: 0,
    truncatedFindings: 0
  };
  const findings = [];

  function addFinding(code, message, index, token) {
    if (findings.length >= MAX_AUDIT_FINDINGS) {
      stats.truncatedFindings += 1;
      return;
    }
    const finding = { code, message, index };
    if (token !== undefined) finding.token = token;
    findings.push(finding);
  }

  if (query.length > maxSqlLength) {
    addFinding(CODE.MAX_SQL_LENGTH, 'SQL length exceeds maxSqlLength (' + maxSqlLength + ')', maxSqlLength);
  }

  let firstNulIndex = -1;
  let nulCount = 0;
  for (let nulSearchIndex = query.indexOf('\0'); nulSearchIndex !== -1; nulSearchIndex = query.indexOf('\0', nulSearchIndex + 1)) {
    if (firstNulIndex === -1) firstNulIndex = nulSearchIndex;
    nulCount += 1;
  }
  if (nulCount > 0) {
    stats.nulBytes = nulCount;
    addFinding(CODE.NUL_BYTE, 'SQL contains a NUL byte', firstNulIndex);
  }

  let index = 0;
  let state = 'normal';
  let quoteStart = -1;
  let quoteKind = '';
  let dollarDelimiter = '';
  let blockCommentDepth = 0;
  let blockCommentStart = -1;
  let statementIndex = 0;
  let statementHasContent = false;
  let statementFirstIndex = -1;
  let statementSegmentCount = 0;
  let semicolonSeen = false;
  let contentAfterSemicolonIndex = -1;
  const tokens = [];

  function markStatementContent(position) {
    if (!statementHasContent) {
      statementHasContent = true;
      statementFirstIndex = position;
    }
    if (semicolonSeen && contentAfterSemicolonIndex === -1) {
      contentAfterSemicolonIndex = position;
    }
  }

  function finishStatementSegment() {
    if (statementHasContent) statementSegmentCount += 1;
    statementHasContent = false;
    statementFirstIndex = -1;
    statementIndex += 1;
  }

  while (index < query.length) {
    const character = query[index];
    if (state === 'single' || state === 'double' || state === 'backtick') {
      const quote = state === 'single' ? "'" : (state === 'double' ? '"' : '`');
      if (dialect === 'mysql' && character === '\\') {
        index += 2;
        continue;
      }
      if (character === quote) {
        if (query[index + 1] === quote) {
          index += 2;
          continue;
        }
        state = 'normal';
        index += 1;
        continue;
      }
      index += 1;
      continue;
    }

    if (state === 'dollar') {
      const end = query.indexOf(dollarDelimiter, index);
      if (end === -1) {
        index = query.length;
      } else {
        index = end + dollarDelimiter.length;
        state = 'normal';
      }
      continue;
    }

    if (state === 'line-comment') {
      if (character === '\n' || character === '\r') state = 'normal';
      index += 1;
      continue;
    }

    if (state === 'block-comment') {
      if (character === '/' && query[index + 1] === '*') {
        blockCommentDepth += 1;
        index += 2;
        continue;
      }
      if (character === '*' && query[index + 1] === '/') {
        blockCommentDepth -= 1;
        index += 2;
        if (blockCommentDepth === 0) state = 'normal';
        continue;
      }
      index += 1;
      continue;
    }

    if (isAsciiWhitespace(character)) {
      index += 1;
      continue;
    }

    if (character === '-' && query[index + 1] === '-') {
      stats.comments += 1;
      addFinding(CODE.COMMENT_TOKEN, 'SQL comment marker -- appears outside a string literal', index, '--');
      state = 'line-comment';
      index += 2;
      continue;
    }
    if (character === '/' && query[index + 1] === '*') {
      stats.comments += 1;
      addFinding(CODE.COMMENT_TOKEN, 'SQL block comment marker /* appears outside a string literal', index, '/*');
      state = 'block-comment';
      blockCommentDepth = 1;
      blockCommentStart = index;
      index += 2;
      continue;
    }
    if (character === '#') {
      stats.comments += 1;
      addFinding(CODE.COMMENT_TOKEN, 'SQL comment marker # appears outside a string literal', index, '#');
      state = 'line-comment';
      index += 1;
      continue;
    }

    if (character === ';') {
      stats.semicolons += 1;
      semicolonSeen = true;
      finishStatementSegment();
      index += 1;
      continue;
    }

    markStatementContent(index);

    if (character === "'" || character === '"' || character === '`') {
      state = character === "'" ? 'single' : (character === '"' ? 'double' : 'backtick');
      quoteStart = index;
      quoteKind = character;
      index += 1;
      continue;
    }

    if (dialect === 'postgres' && character === '$') {
      const delimiter = dollarQuoteDelimiter(query, index);
      if (delimiter !== undefined) {
        state = 'dollar';
        dollarDelimiter = delimiter;
        quoteStart = index;
        quoteKind = delimiter;
        index += delimiter.length;
        continue;
      }
    }

    if (isWordCharacter(character)) {
      const start = index;
      while (index < query.length && isWordCharacter(query[index])) index += 1;
      const word = query.slice(start, index);
      tokens.push({ word, upper: word.toUpperCase(), index: start, statement: statementIndex });
      continue;
    }

    index += 1;
  }

  if (statementHasContent) {
    finishStatementSegment();
  }
  stats.statements = statementSegmentCount;

  if (state === 'single' || state === 'double' || state === 'backtick' || state === 'dollar') {
    addFinding(CODE.UNBALANCED_QUOTE, 'SQL contains an unterminated quoted string or identifier', quoteStart, quoteKind);
  }
  if (state === 'block-comment') {
    addFinding(CODE.UNBALANCED_QUOTE, 'SQL contains an unterminated block comment', blockCommentStart, '/*');
  }

  if (contentAfterSemicolonIndex !== -1) {
    addFinding(CODE.MULTI_STATEMENT, 'SQL contains executable content after a statement terminator', contentAfterSemicolonIndex);
  }

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex];
    if (DANGEROUS_SINGLE_KEYWORDS.has(token.upper)) {
      stats.dangerousKeywords += 1;
      addFinding(CODE.DANGEROUS_KEYWORD, 'SQL contains dangerous keyword ' + token.upper, token.index, token.upper);
    }
    const next = tokens[tokenIndex + 1];
    if (next !== undefined && next.statement === token.statement) {
      if (token.upper === 'INTO' && next.upper === 'OUTFILE') {
        stats.dangerousKeywords += 1;
        addFinding(CODE.DANGEROUS_KEYWORD, 'SQL contains INTO OUTFILE file export syntax', token.index, 'INTO OUTFILE');
      }
      if (token.upper === 'ATTACH' && next.upper === 'DATABASE') {
        stats.dangerousKeywords += 1;
        addFinding(CODE.DANGEROUS_KEYWORD, 'SQL contains ATTACH DATABASE syntax', token.index, 'ATTACH DATABASE');
      }
      if (token.upper === 'BULK' && next.upper === 'INSERT') {
        stats.dangerousKeywords += 1;
        addFinding(CODE.DANGEROUS_KEYWORD, 'SQL contains BULK INSERT syntax', token.index, 'BULK INSERT');
      }
    }
    if (token.upper === 'COPY') {
      for (let lookahead = tokenIndex + 1; lookahead < tokens.length && tokens[lookahead].statement === token.statement; lookahead += 1) {
        if (tokens[lookahead].upper === 'PROGRAM') {
          stats.dangerousKeywords += 1;
          addFinding(CODE.DANGEROUS_KEYWORD, 'SQL contains COPY ... PROGRAM command execution syntax', token.index, 'COPY PROGRAM');
          break;
        }
      }
    }
  }

  return Object.freeze({
    safe: findings.length === 0,
    findings: Object.freeze(findings.map((finding) => Object.freeze(finding))),
    stats: Object.freeze(stats)
  });
}

const sqlcage = Object.freeze({
  SQLCAGE_VERSION,
  DIALECTS,
  CODE,
  SqlCageError,
  sql,
  createSqlCage,
  compileQuery,
  isSqlFragment,
  isValidIdentifier,
  quoteIdentifier,
  createSchemaGuard,
  safeColumns,
  safeOrderBy,
  safeLimitOffset,
  sqlIn,
  sqlValues,
  sqlSet,
  sqlAnd,
  sqlOr,
  sqlJoin,
  escapeLikePattern,
  sqlLike,
  auditSqlQuery
});

export default sqlcage;
