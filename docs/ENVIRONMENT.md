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
| `RELEASE_SHA` | all production runtimes | exact deployed commit; required in production |
| `OUTBOX_WORKER_ID` | production worker | stable identity of the single permanent worker |
| `PGBOSS_SCHEMA` | worker/migrator | explicit queue schema |
| `PGBOSS_RUNTIME_ROLE` | migrator | role receiving pg-boss runtime privileges |

## Optional

| Variable | Scope | Notes |
| --- | --- | --- |
| `OUTBOX_POLL_DELAY_MS` | worker | idle poll delay; defaults to `1000` ms |
| `OUTBOX_SHUTDOWN_DRAIN_TIMEOUT_MS` | worker | maximum graceful drain wait for the active handler; defaults to `30000` ms |
| `LOG_LEVEL` | server/worker | pino level |
| `TIMEWEB_S3_ISOLATION_TEST`, `S3_TEST_*` | explicit local test only | non-production A-to-B denial runner; never set in runtime/deploy env |

The generated release environment additionally binds `AMS_DATA_HUB_WEB_IMAGE`,
`AMS_DATA_HUB_WORKER_IMAGE`, `AMS_DATA_HUB_MIGRATOR_IMAGE`, their exact digests and
the corresponding previous-release identities. Operators do not hand-edit
those values.

Provider credentials are intentionally absent. Add project-specific credentials only through an approved scope.

Secret-bearing consumers accept a `SecretRef`, which contains only an approved
environment variable name. The server-only resolver reads the corresponding
value from the process environment delivered by Secret Master. Application
contracts, browser payloads and operator UI never receive that value; UI status
is limited to `configured` plus a redacted display marker.

## Timeweb S3 credential-isolation proof

`pnpm test:s3-isolation` is intentionally a separate explicit command. It
refuses to run unless `TIMEWEB_S3_ISOLATION_TEST=nonproduction`, two distinct
private buckets and two distinct additional-user credential pairs are supplied
through the local environment. It writes a synthetic object through credential
B, proves credential A receives access denial for that object, proves B can
read it, then deletes the fixture. Its output is secret-free and is the
required provider evidence for ADR-015; it is not a deployment operation.
The proof assigned by master plan v4 to `dh-09.4` passed on 2026-10-05;
see `research/TIMEWEB_S3_ISOLATION_PROOF_2026-10-05.md`. Temporary resources and
credentials were removed. The Timeweb adapter remains disabled in application
runtime; production wiring and real project artifacts require separate approval.

## PostgreSQL Evidence Transition

Integration tests use the guarded `*_test` PostgreSQL 18 lifecycle. A successful
full run emits a secret-free coverage summary; scoped runs do not claim full
coverage. Local evidence is not production attestation. See [`ADR-009`](adr/ADR-009-postgresql-security-evidence.md).

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

The one-shot role bootstrap has its own root-owned `bootstrap.env` containing
`DB_BOOTSTRAP_ADMIN_DATABASE_URL`, exact `DB_BOOTSTRAP_EXPECTED_DATABASE` and
the three `AMS_DATA_HUB_*_DB_PASSWORD` values. Those variables are forbidden in
web, worker and migrator env files. Every production Compose env file is
mandatory, and the container entrypoint rejects an incomplete role-specific
configuration before starting application code.
