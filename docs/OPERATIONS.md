# Operations — AMS Data Hub

**Статус:** Active extension. `03_ARCHITECTURE.md` owns topology and policy;
this file owns executable local, deploy and recovery procedures.

## Local development

### Source runtime composition — command implemented, production activation pending

The server facade binds concrete PostgreSQL revision/staging persistence, real
raw spool and streaming S3 adapter capability with the Safe Outbound gateway.
Source callers supply scoped IDs only; endpoint credentials resolve server-side
at intake. Per-record batches are bounded by 100 records/4 MiB and payloads by
2 MiB. Hashing reads sorted persisted metadata in bounded pages. GOOD and stable
identity/Last Good state commit atomically after fresh enabled, project state,
source configuration, policy, identity and jobs-freeze checks.

Local integration proof uses the actual application facade, PostgreSQL,
filesystem, parser and S3 adapter with mocked HTTP/SDK transport. It is not a
provider compatibility or production activation proof. Missing grace/inactivation
and reactivation now execute only with safe GOOD apply; malformed, invalid,
duplicate, empty and suspicious feeds leave current identities/events/Last Good
unchanged. Baseline leaves pre-revision identities untouched. Synthetic rollback
and competing-run regressions prove transaction failure/stale runs cannot commit
partial inventory or overwrite a newer GOOD. GOOD now records a transactional,
idempotent `snapshot.build.request` outbox intent. `snapshotTriggered=true` is
durable request evidence only; external build/sign/store/publish are subsequent
executors, not part of the import transaction. Outbox enqueue failure rolls back
the complete apply. Four-family composition regressions now exercise persisted
YRL/Vladis, Domclick, Avito v3 and CIAN v2 configuration through the same facade:
GOOD, changed semantic hash, stable UID and broken-input Last Good preservation.
These fixtures use explicit persisted synthetic safety policies and mocked
HTTP/SDK transport; they do not recalibrate live profiles or prove provider
compatibility. The combined `source-worker` command now owns native pg-boss
source consumption and startup/between-job schedule reconciliation. Production
activation and the remaining concurrency/shutdown/health gates are pending. No production
migration or credential creation is performed by the local test lifecycle.

Default outbox claim is restricted to its actual maintenance handler topic.
Snapshot intents remain PENDING until the real build executor is registered;
the real pg-boss default-drain regression also proves maintenance still completes.
The concrete Source facade is exercised with `SET LOCAL ROLE ams_data_hub_worker`
(NOBYPASSRLS), not just the setup login/application principal. A forward migration
adds Project SELECT for runtime status checks while keeping existing project RLS
and withholding Project mutation grants from the worker.
Before enabling snapshot execution, use one complete handler registry for the
shared `outbox.dispatch` queue or split executor queues. Topic-filtered database
claim alone does not filter already-dispatched pg-boss jobs. The default worker
checks the persisted topic after lease takeover and defers reserved Source/build
topics it cannot execute; all other unknown topics remain explicit errors.
The combined command registers maintenance and manual Source dispatch together.

Admin `Run Source` commits its request and IDs-only outbox intent atomically.
Dispatch runs after commit and uses a deterministic request job ID plus Source
singleton. A busy Source defers instead of losing the request. Request COMPLETED
is committed with GOOD/Last Good/snapshot intent, not after import; replay of a
settled request performs no intake. Dispatch infrastructure errors are retryable.
Native terminal retries set request FAILED. If an intent reaches DEAD_LETTER,
startup/maintenance reconciliation settles its scoped request in bounded
100-event pages and can repeat safely after a crash. COMPLETED is preserved.
Busy/reserved events never enter this terminal reconciliation. JobRun DEFERRED
and the durable outbox deferral counter preserve executor retry budget even
after operational JobRun retention. This is a repository/runtime contract,
not provider or production proof.

### Development commands

Canonical mode is Windows-native checkout plus native PostgreSQL 18.

- local database: `ams_data_hub_dev`;
- isolated test database: `ams_data_hub_test`;
- local URL: `http://127.0.0.1:3001`.

```bash
pnpm install
pnpm prisma:generate
pnpm dev:db:status
pnpm dev:start
```

## Active remediation execution boundary

`AMS-DATA-HUB-REMEDIATION-2026-10 v1` is approved for implementation and
non-production verification, not deployment. MP-00 reconciles canon; MP-01
removes legacy TOTP runtime/schema/recovery branches. The target current policy
has no factor enrollment requirement; preserve password/session security,
rate limiting and explicit server permissions.

The production default permanent worker is still an outbox worker, not proof of
production source ingestion. SourceExecutionService is implemented by MP-03;
explicit local combined worker/scheduler/manual composition is implemented
within MP-04, whose concurrency/shutdown/health gates remain open. Real snapshot
assembly is MP-05, and operations build/publish/rollback/
ACK executors plus delivery routes are MP-08. An Admin request or contract test
does not prove execution. Use synthetic local runtime fixtures until separate
authorization for real feeds/PII/provider operations. MP-10 proof precedes any
separately authorized exact-main release.

## Streaming raw artifacts — remediation foundation

MP-02 separates `safeOutboundBuffered` (small files/media, maximum 50 MiB)
from `safeOutboundStream` (HTTPS feeds, caller limit up to 256 MiB). A feed
response is single-use; consumers must consume it or call `close`. The
whole-request timeout also closes an unread response. Large raw feeds do not
use buffered `ObjectStorage.get`.

Each import attempt uses a private random disk lease under the OS temporary
directory, incrementally hashes raw bytes, uploads a fresh file stream with
known length/checksum, and reopens the local spool for the parser. Persisted
receipts contain only the immutable storage key, SHA-256 and byte count.
Normal completion and error paths close readers and remove the attempt lease;
cleanup failures emit a value-free operational signal without rewriting an
already committed GOOD. MP-02.4 binds the narrowest SourceSafety/adapter limit
to HTTP, spool and parser, with at most four active leases and 512 MiB reserved
disk bytes per worker process. ENOSPC/write errors fail before GOOD apply.
The single permanent worker must respect these caps; crash-orphan handling
requires its MP-04 lifecycle binding, because `finally` is not crash recovery. Actual Timeweb
streaming/checksum compatibility is unverified here: tests use synthetic storage
and mocked SDK consumption, not provider credentials or real feeds.

`tests/large-feed-streaming.test.ts` executes a 188,960,772-byte synthetic XML
through Safe Outbound, a real attempt spool, the real S3 streaming adapter with
mocked SDK transport and the real YRL parser (3,072 records). Its value-free
metrics are written to ignored `.local/evidence/mp-02-large-feed-streaming.json`.
Array-buffer growth must stay below 128 MiB and below total feed size; RSS is
observed separately, not advertised as a fixed allocator budget. The complete
MP-02 regression set covers overflow/timeout/redirect/truncation, deterministic
raw hashes across chunk layouts and cancellation/cleanup races.

## Production deployment

Identity: `https://data-hab.ams24.ru`, SSH alias `ams-data-hub-deploy`, app
root `/opt/ams-data-hub`, configuration root `/etc/ams-data-hub`.

1. Confirm clean exact SourceCraft `main` and the green exact-head RISKY gate.
2. Resolve project-only secrets from Secret Master; never print or copy values.
3. Run one manual release workflow and retain web/worker/migrator digests plus
   `registry-manifest.json`.
4. Validate PostgreSQL connection budget and provider backup evidence.
5. Record current and previous immutable references in the release environment.
6. Deploy from a clean checkout of the same SHA; the host only pulls images.
7. Run live/readiness/browser smoke and record proof.

Root-owned mode `0600` runtime env files are separated by web, worker, migrator,
bootstrap and registry concerns. All Compose `env_file` entries are mandatory;
the container entrypoint validates the exact release SHA, database target and
role-specific required variables before starting the process. Registry
credentials never enter application containers.

### Database role bootstrap and migration

Role bootstrap is a controlled one-shot step before the first migration against
a new PostgreSQL cluster and whenever a runtime password is rotated. It creates
or normalizes only `ams_data_hub_web`, `ams_data_hub_worker` and
`ams_data_hub_backup`; all stay `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`,
`NOREPLICATION` and `NOBYPASSRLS`.

1. Resolve the dedicated bootstrap admin URL and three role passwords from the
   project Secret Master scope into `/etc/ams-data-hub/bootstrap.env` with mode
   `0600`. Set `DB_BOOTSTRAP_EXPECTED_DATABASE` to the exact target database.
2. Run the one-shot service:

   ```bash
   docker compose --env-file /opt/ams-data-hub/shared/release.env \
     -f /opt/ams-data-hub/current/docker-compose.production.yml \
     --profile manual run --rm --no-deps db-bootstrap
   ```

3. Confirm the output lists only the three role names; no password or URL may
   appear. Remove the bootstrap admin URL from process memory after the step.
4. Run the `migrate` service with the separate migrator identity. Runtime web
   and worker credentials never receive DDL capability.

For an operator-run Node invocation, the same script accepts all three password
variables through the environment or a JSON object on stdin. Passwords are
bound through session settings and are never added to argv or printed.

### Runtime lifecycle and worker health

Docker Compose is the canonical runtime. `ams-data-hub-web.service` is only a
host-level wrapper around `web` and the single permanent `worker` service. The
retention timer invokes the one-shot `maintenance outbox-retention` command and
must not start another permanent worker.

The worker holds a PostgreSQL advisory lock for its whole process lifetime, so a
second permanent outbox worker fails fast. Its container healthcheck reads the
latest `RuntimeHeartbeat`; healthy means no older than two configured heartbeat
write intervals. PID existence is not accepted as health evidence.

## Recovery and restore

### Current-release account/password recovery

MP-01 preserves the existing protected operator-issued, one-time hashed
Platform Admin recovery token. Completing it rotates the credential, consumes
the token atomically, revokes sibling tokens and old sessions, and never enables
a disabled account. Expired/revoked/consumed tokens do not change credentials.
There is no factor reset or re-enrollment step. Issuance remains an audited,
authorized operator action; no permanent public recovery endpoint is added.
Verify locally with `node scripts/run-integration-tests.mjs
tests/integration/account-setup.integration.test.ts` against the guarded
loopback `*_test` database. This is neither production recovery nor deployment.

### Timeweb S3 project isolation proof

Before the first real project adapter enablement, provision two temporary
non-production private buckets and two distinct least-privilege credentials.
Run `pnpm test:s3-isolation` only with the explicit
`TIMEWEB_S3_ISOLATION_TEST=nonproduction` guard. Acceptance requires
credential A to receive `AccessDenied` for bucket B, credential B to read the
synthetic fixture unchanged, and the fixture to be deleted in `finally`.

Delete the temporary provider policies, users and buckets after the proof and
remove temporary credential pairs from Secret Master. Evidence must contain
only verdicts and fixture hashes, never credentials or provider resource IDs.
The 2026-10-05 run is recorded in
`research/TIMEWEB_S3_ISOLATION_PROOF_2026-10-05.md`; it passed with complete
cleanup. This proof does not enable the application adapter and is not a
production release.

### Isolated restore drill

`pnpm test:data-safety-drill` is the only local restore command. It accepts
only the guarded loopback `*_test` target, freezes mutating jobs before the
logical dump, restores into a distinct `*_restore_test` database, verifies
PostgreSQL 18 and identity invariants, keeps jobs frozen through reconcile and
unfreezes only after a zero-conflict report. The command deletes the temporary
dump and restore database in `finally`; its secret-free evidence remains in
`.local/evidence/data-safety-drill.json`.

Production and managed-provider restore are never inferred from this command.
They require the release procedure, provider backup/retention evidence, an
isolated target and a separate owner-approved cutover.

1. Confirm exact SHA, branch and database target.
2. Check live/ready endpoints, worker heartbeat and outbox health.
3. Roll back application artifacts to the recorded prior digest set.
4. Restore PostgreSQL only into an isolated target first; validate integrity,
   migrations and application reads before any approved cutover.
5. Rotate affected secrets outside Git and record the incident evidence.

Artifact rollback never reverses schema/data. Migrations stay forward-compatible
or require a separately reviewed data-recovery procedure.

## Snapshot signing-key rotation and revocation

Private Ed25519 material exists only in the project Secret Master scope. The
application receives an approved `SecretRef`; the server-only signer resolves
it directly into the crypto adapter. Private key values must never enter Git,
documentation, browser payloads, argv, logs, snapshot files or client trust
sets. Public keys and `keyId` values are non-secret and form the consumer trust
set.

Planned rotation:

1. Generate the next Ed25519 keypair in the approved secure operator contour.
2. Store the next private key only in Secret Master; record its public key and
   `keyId` in the consumer trust set.
3. Prove the overlap state accepts snapshots from both current and next keys.
4. Start signing only higher `publishSequence` values with the next key.
5. Confirm every active consumer accepted the next key before removing the old
   key from the active current/next set.

Emergency revocation:

1. Add the compromised `keyId` to the Hub and consumer revoked lists and stop
   resolving that private key.
2. Activate a safe current/emergency key already present in the trust set.
3. Republish the last approved content as a new snapshot with a strictly higher
   `publishSequence` and the safe `keyId`.
4. Notify or poll consumers and prove the revoked key is rejected even when its
   old cryptographic signature is valid. Rejection must keep last-good intact.

Actual key generation, Secret Master mutation, consumer distribution and live
rotation require a separate owner-approved operation; repository tests use only
ephemeral in-memory keypairs.
