declare const sqlFragmentBrand: unique symbol;

export interface SqlFragment {
  readonly [sqlFragmentBrand]: true;
}

export type SqlDialect = 'postgres' | 'mysql' | 'sqlite';

export const SQLCAGE_VERSION: '1.0.0';
export const DIALECTS: readonly ['postgres', 'mysql', 'sqlite'];

export const CODE: {
  readonly NOT_TAGGED_TEMPLATE: 'SQLCAGE_NOT_TAGGED_TEMPLATE';
  readonly INVALID_FRAGMENT: 'SQLCAGE_INVALID_FRAGMENT';
  readonly INVALID_DIALECT: 'SQLCAGE_INVALID_DIALECT';
  readonly INVALID_OPTIONS: 'SQLCAGE_INVALID_OPTIONS';
  readonly INVALID_PARAMETER: 'SQLCAGE_INVALID_PARAMETER';
  readonly MAX_PARAMETERS: 'SQLCAGE_MAX_PARAMETERS';
  readonly MAX_SQL_LENGTH: 'SQLCAGE_MAX_SQL_LENGTH';
  readonly MAX_FRAGMENT_DEPTH: 'SQLCAGE_MAX_FRAGMENT_DEPTH';
  readonly INVALID_IDENTIFIER: 'SQLCAGE_INVALID_IDENTIFIER';
  readonly INVALID_SCHEMA: 'SQLCAGE_INVALID_SCHEMA';
  readonly UNKNOWN_TABLE: 'SQLCAGE_UNKNOWN_TABLE';
  readonly UNKNOWN_COLUMN: 'SQLCAGE_UNKNOWN_COLUMN';
  readonly EMPTY_COLUMN_LIST: 'SQLCAGE_EMPTY_COLUMN_LIST';
  readonly INVALID_ORDER_BY: 'SQLCAGE_INVALID_ORDER_BY';
  readonly EMPTY_ORDER_BY: 'SQLCAGE_EMPTY_ORDER_BY';
  readonly INVALID_LIMIT_OFFSET: 'SQLCAGE_INVALID_LIMIT_OFFSET';
  readonly EMPTY_IN_LIST: 'SQLCAGE_EMPTY_IN_LIST';
  readonly EMPTY_VALUES: 'SQLCAGE_EMPTY_VALUES';
  readonly EMPTY_SET: 'SQLCAGE_EMPTY_SET';
  readonly EMPTY_CONDITION_LIST: 'SQLCAGE_EMPTY_CONDITION_LIST';
  readonly INVALID_JOIN_SEPARATOR: 'SQLCAGE_INVALID_JOIN_SEPARATOR';
  readonly INVALID_LIKE_PATTERN: 'SQLCAGE_INVALID_LIKE_PATTERN';
  readonly INVALID_INPUT: 'SQLCAGE_INVALID_INPUT';
  readonly MULTI_STATEMENT: 'SQLCAGE_MULTI_STATEMENT';
  readonly DANGEROUS_KEYWORD: 'SQLCAGE_DANGEROUS_KEYWORD';
  readonly COMMENT_TOKEN: 'SQLCAGE_COMMENT_TOKEN';
  readonly UNBALANCED_QUOTE: 'SQLCAGE_UNBALANCED_QUOTE';
  readonly NUL_BYTE: 'SQLCAGE_NUL_BYTE';
};

export type SqlCageErrorCode = (typeof CODE)[keyof typeof CODE];

export class SqlCageError extends Error {
  constructor(code: SqlCageErrorCode, message: string, details?: unknown);
  readonly name: 'SqlCageError';
  readonly code: SqlCageErrorCode;
  readonly details?: unknown;
}

export type SqlTemplateTag = (strings: TemplateStringsArray, ...values: unknown[]) => SqlFragment;
export const sql: SqlTemplateTag;
export function isSqlFragment(value: unknown): value is SqlFragment;

export interface CompileOptions {
  dialect?: SqlDialect;
  maxParameters?: number;
  maxSqlLength?: number;
  maxFragmentDepth?: number;
  allowUndefined?: boolean;
  allowNonFiniteNumbers?: boolean;
  allowObjects?: boolean;
  allowSymbols?: boolean;
  allowFunctions?: boolean;
}

export interface NormalizedCompileOptions {
  dialect: SqlDialect;
  maxParameters: number;
  maxSqlLength: number;
  maxFragmentDepth: number;
  allowUndefined: boolean;
  allowNonFiniteNumbers: boolean;
  allowObjects: boolean;
  allowSymbols: boolean;
  allowFunctions: boolean;
}

export interface PostgresQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

export interface MySqlQuery {
  readonly sql: string;
  readonly values: readonly unknown[];
}

export interface SQLiteQuery {
  readonly sql: string;
  readonly params: readonly unknown[];
}

export type CompiledQuery = PostgresQuery | MySqlQuery | SQLiteQuery;

export function compileQuery(fragment: SqlFragment, options: CompileOptions & { dialect: 'mysql' }): MySqlQuery;
export function compileQuery(fragment: SqlFragment, options: CompileOptions & { dialect: 'sqlite' }): SQLiteQuery;
export function compileQuery(fragment: SqlFragment, options?: CompileOptions & { dialect?: 'postgres' }): PostgresQuery;
export function compileQuery(fragment: SqlFragment, options?: CompileOptions): CompiledQuery;

export interface SqlCage {
  readonly sql: SqlTemplateTag;
  readonly dialect: SqlDialect;
  compile(fragment: SqlFragment, options?: CompileOptions): CompiledQuery;
  compileQuery(fragment: SqlFragment, options?: CompileOptions): CompiledQuery;
  quoteIdentifier(name: string, dialectOrOptions?: SqlDialect | { dialect?: SqlDialect }): string;
  schema(schemaSpec: SchemaSpec, options?: SchemaGuardOptions): SchemaGuard;
  readonly options: NormalizedCompileOptions;
}

export function createSqlCage(options?: CompileOptions): SqlCage;

export function isValidIdentifier(name: unknown): boolean;
export function quoteIdentifier(name: string, dialectOrOptions?: SqlDialect | { dialect?: SqlDialect }): string;

export interface SafeColumnsOptions {
  dialect?: SqlDialect;
  table?: string;
  maxColumns?: number;
}

export function safeColumns(
  columns: readonly string[],
  allowedColumns: readonly string[] | ReadonlySet<string>,
  options?: SafeColumnsOptions
): SqlFragment;

export interface OrderByClause {
  column: string;
  direction?: 'ASC' | 'DESC';
  nulls?: 'FIRST' | 'LAST';
}

export interface SafeOrderByOptions {
  dialect?: SqlDialect;
  table?: string;
  maxClauses?: number;
}

export function safeOrderBy(
  clauses: readonly OrderByClause[] | string,
  allowedColumns: readonly string[] | ReadonlySet<string>,
  options?: SafeOrderByOptions
): SqlFragment;

export interface LimitOffsetInput {
  limit: number;
  offset?: number;
  maxLimit?: number;
}

export interface SafeLimitOffsetOptions {
  maxLimit?: number;
}

export function safeLimitOffset(input: LimitOffsetInput, options?: SafeLimitOffsetOptions): SqlFragment;

export interface SchemaTableSpec {
  columns: readonly string[];
  sortable?: readonly string[];
  sortableColumns?: readonly string[];
}

export type SchemaSpec = Record<string, readonly string[] | SchemaTableSpec>;

export interface SchemaGuardOptions {
  dialect?: SqlDialect;
  maxTables?: number;
  maxColumns?: number;
  maxClauses?: number;
  maxLimit?: number;
}

export interface SchemaGuard {
  readonly dialect: SqlDialect;
  readonly tables: readonly string[];
  table(name: string): SqlFragment;
  column(tableName: string, columnName: string): SqlFragment;
  columns(tableName: string, columns: readonly string[]): SqlFragment;
  orderBy(tableName: string, clauses: readonly OrderByClause[] | string): SqlFragment;
  limitOffset(input: LimitOffsetInput): SqlFragment;
  hasTable(name: string): boolean;
  hasColumn(tableName: string, columnName: string): boolean;
  columnsFor(tableName: string): readonly string[];
  sortableFor(tableName: string): readonly string[];
}

export function createSchemaGuard(schemaSpec: SchemaSpec, options?: SchemaGuardOptions): SchemaGuard;

export function sqlJoin(parts: readonly SqlFragment[], separator?: string): SqlFragment;
export function sqlAnd(parts: readonly SqlFragment[]): SqlFragment;
export function sqlOr(parts: readonly SqlFragment[]): SqlFragment;

export interface SqlInOptions {
  onEmpty?: 'throw' | 'false';
  maxParameters?: number;
  dialect?: SqlDialect;
}

export function sqlIn(values: readonly unknown[], options?: SqlInOptions): SqlFragment;
export function sqlIn(column: string | SqlFragment, values: readonly unknown[], options?: SqlInOptions): SqlFragment;

export interface SqlValuesOptions {
  columns?: readonly string[];
  maxRows?: number;
  maxParameters?: number;
}

export function sqlValues(rows: readonly (readonly unknown[])[], options?: SqlValuesOptions): SqlFragment;
export function sqlValues(rows: readonly Record<string, unknown>[], options?: SqlValuesOptions): SqlFragment;

export interface SqlSetOptions {
  dialect?: SqlDialect;
  allowedColumns?: readonly string[] | ReadonlySet<string>;
  maxColumns?: number;
}

export function sqlSet(assignments: Record<string, unknown>, options?: SqlSetOptions): SqlFragment;

export interface EscapedLikePattern {
  readonly pattern: string;
  readonly escapeChar: string;
}

export function escapeLikePattern(input: string, escapeChar?: string): EscapedLikePattern;

export interface SqlLikeOptions {
  mode?: 'contains' | 'startsWith' | 'endsWith';
  dialect?: SqlDialect;
  escapeChar?: string;
  maxPatternLength?: number;
}

export function sqlLike(column: string | SqlFragment, value: string, options?: SqlLikeOptions): SqlFragment;

export type AuditFindingCode =
  | 'SQLCAGE_MULTI_STATEMENT'
  | 'SQLCAGE_DANGEROUS_KEYWORD'
  | 'SQLCAGE_COMMENT_TOKEN'
  | 'SQLCAGE_UNBALANCED_QUOTE'
  | 'SQLCAGE_NUL_BYTE'
  | 'SQLCAGE_MAX_SQL_LENGTH';

export interface AuditFinding {
  readonly code: AuditFindingCode;
  readonly message: string;
  readonly index: number;
  readonly token?: string;
}

export interface AuditStats {
  readonly length: number;
  readonly bytes: number;
  readonly semicolons: number;
  readonly statements: number;
  readonly comments: number;
  readonly dangerousKeywords: number;
  readonly nulBytes: number;
  readonly truncatedFindings: number;
}

export interface AuditResult {
  readonly safe: boolean;
  readonly findings: readonly AuditFinding[];
  readonly stats: AuditStats;
}

export interface AuditOptions {
  dialect?: SqlDialect;
  maxSqlLength?: number;
}

export function auditSqlQuery(query: string, options?: AuditOptions): AuditResult;

declare const sqlcage: {
  readonly SQLCAGE_VERSION: typeof SQLCAGE_VERSION;
  readonly DIALECTS: typeof DIALECTS;
  readonly CODE: typeof CODE;
  readonly SqlCageError: typeof SqlCageError;
  readonly sql: typeof sql;
  readonly createSqlCage: typeof createSqlCage;
  readonly compileQuery: typeof compileQuery;
  readonly isSqlFragment: typeof isSqlFragment;
  readonly isValidIdentifier: typeof isValidIdentifier;
  readonly quoteIdentifier: typeof quoteIdentifier;
  readonly createSchemaGuard: typeof createSchemaGuard;
  readonly safeColumns: typeof safeColumns;
  readonly safeOrderBy: typeof safeOrderBy;
  readonly safeLimitOffset: typeof safeLimitOffset;
  readonly sqlIn: typeof sqlIn;
  readonly sqlValues: typeof sqlValues;
  readonly sqlSet: typeof sqlSet;
  readonly sqlAnd: typeof sqlAnd;
  readonly sqlOr: typeof sqlOr;
  readonly sqlJoin: typeof sqlJoin;
  readonly escapeLikePattern: typeof escapeLikePattern;
  readonly sqlLike: typeof sqlLike;
  readonly auditSqlQuery: typeof auditSqlQuery;
};

export default sqlcage;
