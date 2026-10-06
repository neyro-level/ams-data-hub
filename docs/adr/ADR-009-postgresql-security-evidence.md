# ADR-009: Cross-Contract PostgreSQL Security Evidence

**Status:** implemented and locally verified in E06
**Scope:** one deterministic PostgreSQL 18 evidence pass above E00A; it does not create a second runner.

## Decision

`pnpm test:integration` becomes the single fail-closed entrypoint created by E00A. E02–E05 own their feature assertions; E06 owns only their composition: the test matrix, empty-database/repeated-run proof, order independence and a machine-readable summary. It may not replace feature behaviour, invoke Docker, or touch an unknown database target.

## Required Matrix

| Contract | Required integration scenarios |
| --- | --- |
| E02 identity | disabled/revoked user loses access on next request; multi-membership has no implicit tenant; setup/account recovery remain guarded; MP-01 proves authorized password-only Admin under the amended ADR-005 policy |
| E03 isolation | missing DB context, cross-tenant read/write and cross-tenant relation are denied; `web`/`worker` cannot bypass RLS; every inventory table is covered |
| E04 command | authorization/context precede persistence; a failed business, audit or outbox operation rolls back the complete transaction; stale result leaves no partial data |
| E05 reliability | competing workers cannot complete one lease; same idempotency key with changed payload conflicts; retry exhaustion creates one safe dead-letter notification; shutdown leaves an explicit recoverable lease state |

Each test names its contract, uses isolated fixture organizations/identities and performs no direct cleanup outside the E00A guarded lifecycle. Tests must not depend on lexical execution order, process-global state or another suite's fixtures.

## Evidence Entry And Summary

The runner sequence is fixed: preflight → generated client → clean migrate → pg-boss migration → neutral seed → feature suites → guarded cleanup. It runs twice from an empty dedicated `_test` database. The second run must establish the same schema/seed assumptions and pass the same matrix.

After a successful run, a machine-readable, secret-free summary records its schema version, PostgreSQL 18, migration id, first/repeated run, PASS status for E02–E05, executed suites and final PASS. It contains no DSN, host, username, token, payload or PII. Missing coverage is a failed result, not an omitted field. Downstream gates may consume it only with the source local evidence; local proof is not CI attestation. Current exact-head SourceCraft gate results
are recorded separately in the delivery ledger.

## Stop Conditions

E06 stops before destructive work if E00A's target guard rejects the database, the target is not an isolated PostgreSQL 18 `_test` database, an E02–E05 feature contract remains unimplemented, or a repeated run exposes state/order dependence. The fix belongs to the owning feature epic unless it is genuinely a cross-contract composition defect.

## Implementation And Evidence Map

| E06 goal | Target implementation | Required evidence |
| --- | --- | --- |
| one entrypoint | extend E00A runner only; no second test runner | runner contract test and negative target-guard test |
| full coverage | explicit matrix-to-suite manifest | test rejects absent E02–E05 matrix row |
| deterministic clean runs | fixture/reset discipline plus two-run orchestrator | clean and repeated PostgreSQL 18 results |
| reusable proof | secret-free JSON summary emitted only after PASS | summary schema/unit test and inspection |
| no false ownership | failures route to E02–E05 unless composition is defective | task/ledger evidence with owning contract |

## Local Verification

The guarded PostgreSQL 18 runner starts twice from an empty schema. The first
pass executes the current suite manifest in `scripts/postgresql-evidence.mjs`;
the second executes the same suites in reverse order. Both passes cover
E02–E05, the current executable RLS inventory and worker lifecycle behavior.
The manifest includes project/domain suites and new-building import evidence;
a targeted run never attests the full matrix. A failed child command throws through
the lifecycle boundary so the guarded final database reset still runs.

Every runner invocation removes stale evidence from an earlier full pass before
environment validation; a targeted run never preserves a previous PASS.
Only after both passes and the final guarded database reset succeed does it
atomically publish
`.local/evidence/postgresql-security-evidence.json`. The ignored artifact
contains schema version, PostgreSQL major, latest application migration, suite
names and PASS verdicts. It contains no connection target, identity, credential,
payload or personal data and remains local evidence, not CI attestation.
