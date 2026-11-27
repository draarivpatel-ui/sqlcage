## Summary

Describe the behavior change and the security reason for it.

## Threat model impact

- Does this change affect parameter binding, identifier validation, helper output, auditing, or the CLI?
- Does it weaken any fail-closed validation? If yes, justify it explicitly.

## Verification

- [ ] `npm test`
- [ ] `node scripts/build-cjs.mjs --check`
- [ ] `node scripts/smoke.mjs`
- [ ] `npm pack --dry-run`

## Regression tests

List the new tests or explain why existing tests already cover the change.
