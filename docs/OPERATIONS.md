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
activation remains pending; MP-04 exact-head delivery is complete. No production
migration or credential creation is performed by the local test lifecycle.

Default outbox claim is restricted to its actual maintenance handler topic.
Snapshot intents remain PENDING when optional snapshot execution is disabled;
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
The combined command registers maintenance and manual Source dispatch together,
plus snapshot execution when explicitly enabled with validated scoped bindings.

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

Source-wide admission is enforced inside the concrete execution facade, including
direct callers. Exclusive admission transitions without a gap to a session shared
guard retained through raw cleanup. Short shared transaction fences verify the
original guardian PID and two opaque random session markers before work and
after mutations. A guardian disconnect aborts the attempt; a transaction already
in progress blocks replacement admission until it ends, and stale work cannot
commit GOOD after ownership transfer. No long transaction spans HTTP/S3/parser
I/O. Guard acquisition is bounded to four per process and five seconds; uncertain
unlock destroys its client. Existing source/version/policy/identity checks remain.
BUSY is a native 30-second deferral, not a failed execution: the pg-boss 12 adapter
uses an atomic active-attempt CAS and retains retry count and manual request.
Deferral infrastructure failure stops the consumer rather than terminally failing
that request. SIGINT/SIGTERM stop new fetch and cancel an active Source using
the bound server-owned signal. Cancellation completes raw disposal and guard
release before atomic WORKER_SHUTDOWN deferral; REQUESTED/CLAIMED remains
recoverable and retries are not spent. Already committed GOOD is acknowledged.
The CLI then closes the queue, permanent guard and Prisma pool. Its shutdown
deadline includes acquisition, settlement and cleanup; timeout is fatal and
leaves unsettled work for native lease recovery, never a fake graceful result.
The worker-only Compose template uses 640 MiB tmpfs and 60-second stop grace;
other roles and the default outbox-worker command remain unchanged. The deploy
script uses this canonical Compose template; its separate migrator tmpfs stays
64 MiB. No live environment or deployment is changed by this repository work.

The native child-process regression uses the actual CLI, PostgreSQL and durable
queues with synthetic HTTP/S3 transport. It covers cancellation before response
headers and during upload, restart of the same deferred request, GOOD committed
before native ACK, and a non-cancellable SDK fatal timeout. Windows invokes the
registered SIGTERM handler through test IPC; it does not prove an OS Unix signal.
The Linux exact-head delivery gate must run the same regression with OS SIGTERM.
Fatal termination does not guarantee spool cleanup or immediate lease recovery.

For an explicitly selected Source command, use the same stable configured
`OUTBOX_WORKER_ID` (or the same explicit argument) for `source-worker` and
`source-healthcheck`. The latter is a read-only qualified heartbeat probe:
pg-boss connected and Source consumer active mean successfully observed within
the 120-second TTL. Startup/reconciliation, queue failures, stale/future clocks
and another owner's heartbeat cannot fabricate readiness. A serial 30-second
pump keeps the observation current through long imports, revokes failed probes
and awaits in-flight writes before exact-row cleanup. A five-second probe timeout
never starts another probe until its original settles. Consumer settlement
starts the CLI watchdog even without SIGTERM. Original permanent guardian loss
is process-fatal; after abrupt death a row can remain qualified until TTL.
No Source production healthcheck or deployment mode is silently selected.
The reusable `runSourceWorker()` API does not acquire the permanent process
guard itself: actual CLI `main` owns that guard and watchdog. Embedded callers
must provide their own process ownership/lifecycle; direct invocation is not a
single-permanent-runtime or process-fatal-deadline guarantee.

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
within MP-04. Concurrency and controlled shutdown have local runtime evidence;
Source health now has its explicit command and exact-owner qualification;
MP-04 exact-head delivery is complete. Real snapshot
assembly/publication is implemented and delivered by MP-05;
operations build/publish/rollback/
ACK executors plus delivery routes are MP-08. An Admin request or contract test
does not prove execution. Use synthetic local runtime fixtures until separate
authorization for real feeds/PII/provider operations. MP-10 proof precedes any
separately authorized exact-main release.

Operational BUILD is registered by the existing combined source-worker only
with SNAPSHOT_BUILD_ENABLED=true; absent/false leaves its requests reserved.
It stages a request-owned immutable signed build, never publishes current.
Local native runtime proof covers enabled completion, disabled/invalid startup,
and crash recovery using the saved stage under a new lease without repeated
capture/PUT or credential resolution. It observes and clears the exact worker's
heartbeat. This synthetic pg-boss/SDK proof does not activate production or
prove a live provider.
Operational selected PUBLISH is registered independently with
SNAPSHOT_PUBLISH_ENABLED=true (absent/false remains reserved), using the same
project registry's public trust fields only. BUILD and signing can stay disabled.
Actual combined-runtime pg-boss proof covers enabled completion, disabled/no GET,
invalid registry before startup, recovery after an atomic late SUCCESS rollback,
and queue-ACK-loss replay after freeze/SUSPENDED with unavailable public/storage
refs. PUBLISH performs bounded GET only, no new capture/sign/PUT/HEAD; exact own
heartbeat is observed active and cleared after joined stop. Runtime snapshot
matrix now covers BUILD, PUBLISH and ROLLBACK — 17/17 PASS with synthetic SDK
transport. ACK rotation and manual approval add their separately verified
executors below. No production
activation is implied.
Startup revokes the previous exact-owner qualification before validating storage
or capabilities. An invalid new configuration cannot leave a crashed process's
fresh heartbeat reporting active until TTL; pre-aborted startup remains a no-op.

Historical rollback uses a snapshot-owned current-rights admission prerequisite.
It accepts old GOOD content after head
advance but rejects current identity/consent/visibility/assignment/contact/media
permission loss, EXCLUDE and disabled/SUSPENDED/frozen state. Agent contact
fingerprints are value-free; assignment checks the current selected GOOD fact
instead of any historical row. No ordinary PUBLISH gate or RLS grant is weakened.
Durable request-bound sequence/time/source identity and immutable signed binding
with a one-time stage marker are implemented in the snapshot-private repository.
Each mutable step validates the full current accepted lease; valid takeover keeps
the original reserved identity. These metadata APIs are not an executor or proof
of external IO. Internal bounded artifact reading now retains the authenticated
compressed bytes for unchanged-file reuse without extra GETs or recompression;
consumer trust, privacy and limits are unchanged. Approved-source loading validates
exact committed run/binding/root capture, with stage pins when present, before
config/IO and authenticates retained
exact-source PUBLIC Ed25519 key in a separate archive-only trust view. This permits
reading an already-approved revoked/noncurrent source, never accepting a revoked
new signature or changing ordinary PUBLISH. Root identity adaptation is private
attribution only; original source bytes/signature remain pinned. Safe-key restart/
staging server now binds the higher-sequence actual signature before IO, PUTs only
the new manifest, awaits settlement and records staging after fresh lease/rights/
current-trust admission. Pending binding reuses exact bytes without signing;
revoked pending key denies recovery. Snapshot-owned finish atomically publishes
current/run under final full lease/current trust and permissions. Committed run
replay needs no config/IO/fresh rights and does not rewind newer current.
The concrete operational adapter now commits current/run/request SUCCESS together
under global → publication → input locks and the complete accepted event/job lease.
The SQL success guard verifies exact source run, root capture, immutable staged
binding, new run and the strict six-field result; late failure/cancellation rolls
back all three states. Register it with SNAPSHOT_ROLLBACK_ENABLED=true (absent/false
reserves the topic), independently of BUILD/PUBLISH. Startup validates the existing
value-free signing/public registry; actual signing re-reads current configuration.
Keep the approved source's PUBLIC key for archive authentication, never its private
secret. New manifests must use a current/next non-revoked key. Committed operational
replay precedes config/IO, including after freeze/SUSPENDED and unavailable refs.
Native pg-boss proof covers enabled, disabled, invalid, late-SUCCESS crash recovery
and queue-ACK-loss replay; own readiness is observed and cleared after joined stop.
This remains local synthetic implementation proof, not live-provider/production proof.

## Operational ACK rotation — local implementation

ACK_ROTATE requires an explicit STAGE/PROMOTE phase and expected credential version
in the accepted request; IDs-only outbox messages do not carry tokens. Missing
credentials cannot be initialized by rotation. With ACK_ROTATION_ENABLED=true,
the existing combined worker validates PROJECT_ACK_ROTATION_BINDINGS before queue
startup. Keep it absent/false unless enabling this capability is separately approved.
STAGE lazily resolves the exact project's approved nextTokenRef, checks a bounded
32–512-byte token and rejects the current token or an already-staged next token.
During overlap, both current and next authenticate ACK. PROMOTE uses the persisted
next hash and its exact immutable STAGE proof, without resolving any token value;
after promotion, the former current token no longer authenticates ACK.
Every transition increments version once. A stale version or two competing requests
cannot overwrite a newer credential. Final full-lease/fresh-admission fencing commits
credential, private receipt and request SUCCESS atomically. A lost lease cannot
recover SUCCESS; historical committed replay needs neither config nor current rights
and never changes a newer credential. Fleet displays only version. Secrets stay
server-side; the form accepts phase/version only. Native tests prove local synthetic
behavior and real pg-boss execution, not browser/live-provider/production readiness.

## Operational SUSPICIOUS approval — local implementation

An accepted Admin APPROVE request pins the source/revision and private reason.
The existing combined worker routes it beside REJECT; it does not fetch the feed,
resolve endpoint/storage credentials, reparse XML or reinterpret staged records
using a live producer profile. Revision-bound SUSPICIOUS analysis is recomputed;
critical/invalid/rejected evidence is not approvable. Changed source version,
LastGOOD baseline or policy requires revalidation, not silent adoption of latest.
The source must be enabled and the project ACTIVE/unfrozen. Actual ingestion apply
updates stable identities, missing grace/reactivation/events, GOOD/LastGOOD and
snapshot intent atomically with audit and request SUCCESS. Independent SQL checks
actual mutations, not a status-only receipt. Late failure/cancellation rolls the
entire cut back. Exact historical replay reads durable proof before mutable rights
and does not reapply inventory or enqueue another snapshot. Local synthetic proof
does not activate production or establish HTTP delivery/browser readiness.

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

MP-10.3 adds an internal project/SHA lifetime guardian before raw PUT and keeps
it through receipt registration, staging/apply or failure settlement. Successful
verified receipts are registered on the PENDING revision before parsing, so a
malformed XML attempt retains its raw provenance without producing GOOD or a
snapshot intent. Before external PUT, `RawArtifactPutAttempt` commits the exact
project/Source/revision/hash/key/byte intent. Verified receipt registration
atomically settles that intent to STORED and records the revision receipt;
deferred SQL guards verify the final agreement at commit. A failed or unknown
PUT remains PENDING, including after a later successful attempt for the same
SHA. It is neither a fabricated successful receipt nor automatically collectible.

Shared producer session locks allow deduplicated uploads; retention requires an
exclusive lifetime lock. A separate admission key is held only during acquisition
and transaction fences. Business fences order global safety → admission → rows;
retention fences do not reacquire their own exclusive lifetime key on a different
connection. PID and two session markers fence lost guardians. Transaction locks
continue excluding conflicting admissions until commit/rollback after guardian
loss. External storage IO remains outside database transactions.

The pure retention planner preserves the union of the last three GOOD revisions
per Source and references from the last 30 days, across all Sources sharing the
project/SHA. Pins, unsettled references, frozen jobs and incomplete coverage
retain the object; overrides require a documented purpose. Planner decisions are
not DELETE authorization. The ingestion-owned source reader uses a fresh
ReadCommitted transaction under the global safety fence and a SELECT-only
`raw-artifact-retention` project-job purpose. It collects actual Last GOOD,
ACTIVE inventory historical facts and raw provenance (including missing-grace),
deduplicated project/SHA references and unfinished PUT intents. Its bounded cut
allows at most 500 Sources, 5,000 revisions/PUT intents and 50,000 ACTIVE
identities; overflow or missing/inconsistent provenance marks source coverage
INCOMPLETE and keeps all candidate objects. Source coverage is not overall
coverage: snapshot/current/pending/rollback pins must be composed separately.
The snapshot-owned reader resolves current and unfinished DeliveryRuns, captures
not yet published, rollback reservations and actual pending Operations targets.
It verifies immutable input/part digests with the existing input repository,
then ingestion validates captured GOOD/source/head/sequence and inventory
UID/external ID/normalized hash/raw SHA provenance. Current mutable Source heads
are not substituted for captured heads. Work is bounded across the entire cut:
128 roots, 32 MiB of stored payload, 50,000 records and 2,048 parts; overflow,
legacy/unreconstructable roots or contradictory provenance fail coverage closed.
Only identifiers/SHA pins escape, not captured private payloads. This reader
does not itself compose the final cleanup cut or authorize storage deletion.
The worker-root cut composes Source, Operations and Snapshot readers in the same
fresh transaction, verifies every captured revision/SHA pin exists in its bounded
Source references, and fails overall coverage closed if any owner cut is incomplete.
Operational request acceptance takes the global safety fence before idempotency
or outbox locks, so new pending publish/rollback targets cannot commit unnoticed
during this cut. Complete coverage still requires the deletion executor's own
exclusive lifetime guardian and durable admission; it is not a storage capability.
New capture admission additionally resolves the server-built revision/SHA pins
on a bounded second authorized ReadCommitted connection while the outer
RepeatableRead capture holds global. That second connection does not reacquire
global (which would self-deadlock); it observes journal commits predating the
lock acquisition even when the outer RR snapshot does not. Intersecting
PENDING/ACKNOWLEDGED deletion returns retryable `RAW_RETENTION_IN_PROGRESS`
and rolls back sequence/input writes. Existing receipt replay creates no new
root; DELETED does not forbid rebuilding from persisted normalized facts.
All deletion journal writers now take global before rows. New selected publish
and rollback requests use a Snapshot-owned boolean-only definer in the same
fenced RC transaction, after durable replay/project validation but before
audit/outbox writes. It resolves the exact approved target, including automatic
normal publication and staged rollback roots, and checks scoped captured GOOD
revision/SHA pins. Web receives neither private payloads nor journal access.
Unknown targets/provenance or budget overflow fail closed; PENDING/ACKNOWLEDGED
intersections return retryable `RAW_RETENTION_IN_PROGRESS`. This admission
mechanism does not enable the still-unimplemented DELETE executor.
`RawArtifactDeletion` persists immutable project/SHA,
key and policy with PENDING → ACKNOWLEDGED → DELETED phases. Actual producers
deny PUT while PENDING or ACKNOWLEDGED exists, even after guardian release and
for another Source in the same project. The journal has no web grants and
source-import cannot write deletion records. Unknown deletion outcomes must stay
pending; an object existence probe alone does not settle still-possible external
IO. Raw deletion is **not enabled**: complete repository pin/unfinished-PUT
coverage, the actual journal-backed DELETE executor, idempotent provider handling
and crash settlement with audit are still required before activating cleanup.

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

The forward migration `20261007093000_snapshot_input_generated_sizes` adds stored
generated columns to `SnapshotBuildInputPart`. PostgreSQL may rewrite the existing
table and take an exclusive schema lock. Before a separately approved production
release, assess receipt-table size, rehearse on a representative restored copy,
and schedule the migration lock/window with bounded lock acquisition. Local native
integration proof is not evidence of production lock duration or release approval.

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

`pnpm test:data-safety-drill`, with `APP_ENV=test`, is the local restore command.
It accepts only literal loopback port 5435 and the dedicated `ams_data_hub_test`
source, restoring into the distinct `ams_data_hub_restore_test` database.
The prepare process creates an actual synthetic GOOD import, UID, published URL,
signed snapshot and stage receipt, then freezes through the actual web command.
Logical dump/restore preserves runtime function ownership and grants; stripping
these would invalidate NOBYPASS recovery proof. The restore process verifies
PostgreSQL 18 and exact SHA-256 fingerprints of fifteen nonempty persisted
tables before any transitions. Actual reconcile/unfreeze execute as NOBYPASS
web, reading persisted counts through the worker-owned counts-only capability;
caller zeroes alone cannot authorize recovery. Jobs remain frozen through
reconcile, stale publication-time disagreement blocks unfreeze without success
audit, and only a fresh zero-conflict report permits unfreeze.
The command deletes the temporary dump and restore database in `finally` and
resets the source test database. Prior PASS evidence is cleared at startup;
`DATA_SAFETY_DRILL_V2` PASS is written only after successful cleanup to
`.local/evidence/data-safety-drill.json`. Source intake/storage transports are
synthetic; this proves PostgreSQL restoration, not S3 object/provider restoration.

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
