# Good first issues

These ten starter specifications are designed for new contributors. Each one should include tests and should preserve zero runtime dependencies.

## 1. Audit byte length fuzz corpus

Add a table-driven test corpus covering multi-byte UTF-8 input. Assert that `stats.length` remains the JavaScript string length while `stats.bytes` is the correct UTF-8 byte length. Include unpaired surrogates and document the chosen counting behavior.

## 2. SQLite examples in README

Add a complete SQLite driver-agnostic example that shows how to adapt `{ sql, params }` to two common SQLite APIs. Do not add either driver as a dependency.

## 3. CLI help snapshot tests

Add tests that assert every documented CLI flag appears in `--help` output and that unknown suggestions remain plain ASCII. Keep the test independent of terminal width.

## 4. More order string coverage

Add table-driven tests for whitespace around compact `safeOrderBy` strings. Document which whitespace is accepted and reject ambiguous empty direction or nulls segments.

## 5. Schema guard error details

Improve `UNKNOWN_TABLE` and `UNKNOWN_COLUMN` error messages so they name the offending table or column without echoing control characters. Add tests with newline and escape-byte input.

## 6. Audit fixture directory

Create a small `fixtures/audit/` corpus of clean and risky SQL files, then test that the CLI exit code matches a machine-readable manifest. Do not include real secrets or production SQL dumps.

## 7. TypeScript consumer smoke fixture

Add a dependency-free structural test that reads `types/index.d.ts` and verifies overload names and return interfaces remain present. Do not add TypeScript as a dependency unless maintainers explicitly change the zero-runtime-dependency policy.

## 8. Values row shape documentation

Expand the `sqlValues` documentation with examples of valid array rows, valid object rows, ragged rows, and shape mismatch errors. Add tests proving that hostile strings remain bound values.

## 9. Auditor line and column positions

Design and implement optional line and column fields on audit findings while preserving the stable zero-based `index`. Cover CRLF input in tests even though repository files themselves use LF.

## 10. Parameter policy decision matrix

Add a documentation table showing which parameter types are accepted by default and which explicit option changes each decision. Include `undefined`, non-finite numbers, objects, arrays, dates, byte arrays, symbols, and functions.
