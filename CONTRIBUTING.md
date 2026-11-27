# Contributing to sqlcage

Thank you for helping improve sqlcage. Security-focused contributions are welcome, especially tests that reproduce a concrete bypass or unsafe edge case.

## Ground rules

- Keep the package free of runtime and development dependencies.
- Support Node.js 18 and later.
- Keep ESM and CommonJS behavior identical.
- Do not weaken fail-closed validation to make a convenience case pass.
- Do not add a raw SQL interpolation escape hatch.
- Add regression tests for every security fix.
- Use ASCII hyphen punctuation in documentation and source text.

## Local verification

Run these commands before opening a pull request:

```sh
npm test
node scripts/build-cjs.mjs --check
node scripts/smoke.mjs
npm pack --dry-run
```

The test script intentionally enumerates `tests/*.test.mjs` with `fs.readdirSync` and invokes `node --test` through `process.execPath`. This avoids platform differences in shell glob expansion.

If `src/index.mjs` changes, regenerate the CommonJS output:

```sh
node scripts/build-cjs.mjs
```

Commit the updated `dist/index.cjs` in the same change.

## Security contributions

For a vulnerability, follow `SECURITY.md` instead of opening a public issue. For non-sensitive hardening ideas, include:

1. The SQL injection shape or failure mode.
2. A minimal reproduction.
3. The expected fail-closed behavior.
4. Tests for PostgreSQL, MySQL, or SQLite output when dialect behavior matters.

## Style

- Use plain JavaScript in `src/index.mjs`.
- Keep public API errors stable through `SqlCageError.code`.
- Prefer immutable public results.
- Validate input at the boundary and fail closed.
- Keep the CLI free of shell invocation.
- Do not introduce generated files other than `dist/index.cjs` through the checked-in build script.

## Pull requests

Explain the threat model impact of a security change. A pull request that only refactors security code should say why behavior is unchanged and which tests prove parity.
