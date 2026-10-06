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
| `PROJECT_STORAGE_BINDINGS` | source-worker | value-free exact organization/project registry of five environment reference names; no implicit global S3 fallback |
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

The MP04 command foundation adds `pnpm worker:source` / `source-worker`, an
explicit combined outbox/source runtime sharing the existing permanent-worker
guard and one pg-boss lifecycle owner. Production Compose still runs the
existing `outbox-worker`; no deployment or provider activation is performed.
`PROJECT_STORAGE_BINDINGS` is a strict JSON array (1–256 entries, 128 KiB cap)
whose entries contain `organizationId`, `projectId`, `bucketRef`, `endpointRef`,
`regionRef`, `accessKeyIdRef`, `secretAccessKeyRef`. Reference fields contain
uppercase environment names, never values. One explicitly bound project may
reuse `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`; other projects require their own approved references.
Missing, duplicate or malformed bindings fail closed before queue startup.
Adapters resolve lazily after Source scope checks; another project has no
fallback, and shared resolved bucket/user identities are rejected. Bindings
and cached adapters are process-lifetime configuration; change them only with
the approved environment/restart operation. This code creates no credentials.
The native queue consumer now has synthetic PostgreSQL proof through the
default `runSourceWorker`: real pg-boss job → scoped non-bypass import queries
→ GOOD revision; a malformed next feed retries its job and keeps Last Good.
Only outbound HTTP and SDK transport are replaced; SourceExecutionServer is
not called directly by the test. Import results are typed and only a GOOD
result pinned to that Source may complete the job. FAILED/absent/cross-source
results fail it with a value-free code; queue payload IDs are bounded and no
endpoint override is accepted. At startup and every 60 seconds between jobs,
the same runtime reconciles persisted Source schedules with native pg-boss
UTC five-minute ticks. Disabled, manual-only and deleted Source schedules are
removed; every job freshly checks Source scope, enablement, cadence and Project
service state before import. Global reconciliation reads only Source metadata,
not tenant-private Project relations, and rejects over 10,000 Sources or native
schedules instead of silently truncating the registry. This is not
provider attestation: synthetic PostgreSQL proof waits for a real native cron
tick to produce a SCHEDULED job and GOOD through the default runtime, verifies
orphan removal, then changes the Source to manual-only and verifies unscheduling.
HTTP and SDK transports alone are replaced. The combined runtime also registers
the manual Source topic. Admin request, audit and IDs-only outbox intent share
one transaction. Dispatch uses a deterministic native job ID per persisted
request and the Source singleton; a different busy job defers the intent.
Only MANUAL jobs may carry `manualRequestId`; scoped persisted request state
is checked before intake. GOOD, Last Good, snapshot intent and request COMPLETED
commit together, so native settlement retry cannot repeat a completed import.
Transient dispatch reads/queue errors retry; terminal native attempts mark the
request FAILED. Terminal dispatch intents are reconciled in bounded 100-row
pages at startup and maintenance, recovering a crash before request FAILED.
Already-dispatched reserved topics without an executor return to PENDING and
record JobRun DEFERRED, never fake SUCCESS or DEAD_LETTER. Persisted deferral
counts do not consume the executor failure budget or reset attempt ordinals.
Synthetic PostgreSQL regressions exercise the real Admin command and default
runtime across enqueue rollback, dispatch/native settlement faults, one GOOD
and one intake despite replay, foreign-project denial, busy deferral, reserved
snapshot retention and terminal-request recovery on default worker restart.
They replace HTTP/SDK transport, not command, queue, repository or import service.
The concrete facade also performs nonblocking scoped admission before loading
Source/Last Good or opening intake. One existing pooled guardian holds a shared
session lock for the whole import and raw cleanup; exclusive admission prevents
a second importer. At most four guardian acquisitions are retained per process,
with a five-second connection/query deadline and safe late-client release.
Every execution transaction holds a compatible shared transaction fence and
checks the original PID plus two server-owned random session markers, including
after mutation before commit. No private session metadata or new role grants are
needed. A dead guardian aborts intake/spool and blocks stale GOOD; a fenced
transaction prevents ownership transfer until commit/rollback. Cleanup may only
mark its own non-GOOD revision FAILED. Existing version/policy/identity checks
remain in force. Unlock uncertainty destroys the pooled client.
SOURCE_EXECUTION_BUSY leaves the manual request unchanged. The version-pinned
pg-boss 12 adapter atomically returns only the matching active Source job to
created with a 30-second delay, retaining its row/payload/singleton and retry
count. Stale attempt metadata cannot defer another attempt; contention never
calls terminal request failure. Controlled SIGTERM shutdown and source
health proof remain subsequent MP04 tasks. The current production 64 MiB tmpfs is
not intake capacity proof for the up-to-256 MiB source spool.

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
