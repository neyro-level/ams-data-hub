# Release Checklist — AMS Data Hub

**Статус:** Active
**Applicability:** production release `ams-data-hub` на
`https://data-hab.ams24.ru`. Текущий approved plan production не разрешает.

## Guarantee-to-proof matrix

| Гарантия | Proof |
| --- | --- |
| Auth, principal и tenant isolation | auth/RLS tests и `pnpm verify:rls-coverage` |
| Atomic mutations и audit | command tests и PostgreSQL rollback scenarios |
| Async/outbox reliability | lease, retry, dead-letter и shutdown tests |
| Exact-head quality gate | один manual SourceCraft RISKY gate для CRITICAL profile |
| Immutable release | web/worker/migrator digests и registry manifest exact main SHA |
| Runtime readiness | health/live, health/ready, worker и browser smoke |

## Before rollout

- [ ] Clean canonical SourceCraft `main`; exact SHA recorded.
- [ ] Один green exact-head RISKY gate; push/PR остаются zero-CI.
- [x] Non-production Timeweb S3 A→B denial proof and temporary-resource cleanup
      recorded in `research/TIMEWEB_S3_ISOLATION_PROOF_2026-10-05.md`.
- [ ] Project-owned Secret Master scope and separate managed PostgreSQL roles.
- [ ] Production runtime roles have no DDL or `BYPASSRLS`.
- [ ] One immutable non-root image set: web, worker and migrator.
- [ ] Registry digests, connection budget, backup and restore proof recorded.
- [ ] Trusted proxy/origin boundary configured and verified.

## Rollout and live proof

- [ ] Run one manual SourceCraft release workflow for exact `main`.
- [ ] Production host pulls exact digests and never builds.
- [ ] Apply forward-compatible migrations through the migrator identity.
- [ ] Smoke `/api/health/live`, `/api/health/ready`, `/`, workspace and Admin.
- [ ] Record timestamp, SHA, digests and operator-visible outcome.

## Known bounded exceptions

- First release has no previous application image; later releases retain the
  prior digest set.
- The release manifest and rollback contract are locally proven, but no image
  digest, rollout or live rollback exists until a separately authorized exact-
  `main` release.
- Local checks are not CI attestation or live proof.
- Managed PostgreSQL backup evidence remains provider-owned until captured.

## Handover and rollback

- Stop rollout and retain failed evidence.
- Roll back only to recorded immutable digests; never rebuild ad hoc.
- Artifact rollback does not reverse schema/data. Restore only through the
  reviewed isolated recovery procedure in `OPERATIONS.md`.
- Final closure records exact main SHA, gate URL/verdict, registry manifest,
  rollout result and rollback unit. Production always requires a separate
  explicit owner command.
