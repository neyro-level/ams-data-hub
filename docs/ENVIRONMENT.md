# Environment

**Status:** Active extension. This file is the value-free variable registry
defined by `03_ARCHITECTURE.md`.

Use `.env.example` as the value-free project template.

## Required

| Variable | Scope | Notes |
| --- | --- | --- |
| `APP_ENV` | server | `development`, `test` or `production` |
| `DATABASE_URL` or `DATABASE_*` | server | PostgreSQL connection |
| `BETTER_AUTH_SECRET` | server | secret, production-only value |
| `BETTER_AUTH_URL` | server/public origin | exact app URL |

## Optional

| Variable | Scope | Notes |
| --- | --- | --- |
| `OUTBOX_WORKER_ID` | worker | unique identity per running worker replica |
| `OUTBOX_POLL_DELAY_MS` | worker | idle poll delay; defaults to `1000` ms |
| `OUTBOX_SHUTDOWN_DRAIN_TIMEOUT_MS` | worker | maximum graceful drain wait for the active handler; defaults to `30000` ms |
| `PGBOSS_SCHEMA` | worker | defaults to `pgboss` in scripts |
| `RELEASE_SHA` | server | exact deployed commit |
| `LOG_LEVEL` | server/worker | pino level |

The generated release environment additionally binds `AMS_DATA_HUB_WEB_IMAGE`,
`AMS_DATA_HUB_WORKER_IMAGE`, `AMS_DATA_HUB_MIGRATOR_IMAGE`, their exact digests and
the corresponding previous-release identities. Operators do not hand-edit
those values.

Provider credentials are intentionally absent. Add project-specific credentials only through an approved scope.

## PostgreSQL Evidence Transition

E06 uses only the E00A guarded `*_test` PostgreSQL 18 lifecycle. A successful integration pass emits a secret-free coverage summary for E02–E05; it is local starter evidence, never production attestation. See [`ADR-009`](adr/ADR-009-postgresql-security-evidence.md).

## Integration-test database

`pnpm test:integration` accepts only a native PostgreSQL 18 target whose
`APP_ENV=test`, host is literal loopback, database ends in `_test` and role is
different from `LOCAL_POSTGRES_USER`. The command resets only that guarded
database before and after the run; it never uses `DATABASE_URL` from a
development or production target.

## Production identity split

Web, worker, migrator and backup use separate environment files. The migrator
alone receives the DDL-capable role; web and worker retain the non-owner roles
defined by E03. Backup credentials live only in the systemd backup environment.
The template contains names and interfaces, never provider credentials.
