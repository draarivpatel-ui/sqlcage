# Security policy

sqlcage is a defensive library. Reports about bypasses, unsafe defaults, injection shapes, or unintended raw-SQL trust are treated as security-sensitive.

## Supported versions

| Version | Status |
| --- | --- |
| 1.0.x | Intended initial supported line |

Until the package is published, use the repository revision itself as the unit of assessment rather than assuming registry availability.

## Reporting a vulnerability

Do not open a public issue with a working exploit, proof-of-concept payload, or unpatched bypass.

Use the repository's [GitHub Security Advisory form](https://github.com/draarivpatel-ui/sqlcage/security/advisories/new). Do not open a public issue with the payload.

Include these details when safe to share privately:

- Affected version or commit.
- A minimal JavaScript reproduction.
- The exact SQL text sent toward the database driver.
- Whether the issue depends on PostgreSQL, MySQL, SQLite, or a specific driver.
- Whether the bypass involves tagged templates, schema identifiers, helper output, the auditor, or the CLI.

## Scope

In scope:

- Forging or mutating a trusted SQL fragment.
- Causing a value to concatenate into SQL instead of binding as a parameter.
- Bypassing identifier validation with control characters, Unicode, prototype-pollution names, or dialect quote characters.
- Producing unsafe dynamic `ORDER BY`, `IN`, `VALUES`, `SET`, or `LIKE` output through documented helpers.
- Excessive memory or CPU use that violates documented compile caps.
- CLI file-handling bypasses involving links, non-regular files, terminal control injection, or incorrect exit codes.

Out of scope:

- SQL concatenated by an application outside sqlcage.
- A database account with excessive privileges.
- Driver behavior after a correctly parameterized query has left sqlcage.
- The fact that the lexical auditor cannot prove arbitrary SQL safe.
- Attacks requiring the attacker to execute arbitrary JavaScript in the application process.

## Disclosure timeline

- Acknowledgment: within 48 hours.
- Initial assessment: within 7 calendar days.
- Fix or mitigation plan: within 30 calendar days for confirmed high-impact reports.
- Coordinated public disclosure: up to 90 days by default, adjusted by mutual agreement when exploitation or user risk requires a different date.

## Hardening posture

sqlcage fails closed for malformed templates, forged fragments, unknown identifiers, invalid numeric input, non-finite numbers, undefined values, malformed objects, excessive parameter counts, excessive SQL length, and excessive fragment depth. Changes that weaken those checks require a strong compatibility reason and regression tests proving no new injection path.
