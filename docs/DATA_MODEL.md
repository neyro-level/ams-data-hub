# Data Model

**Status:** Active extension. `prisma/schema.prisma` and migrations remain the
runtime source of truth; this file is their neutral model map.

Prisma schema is the runtime source of truth.

Prisma PostgreSQL pools pin each connection to `TimeZone=UTC` through connection
startup options, for both URL and component configuration. The installed
`adapter-pg` serializes Date values without a timezone offset and expects UTC
timestamp results; a non-UTC session can therefore shift persisted instants.
Signed snapshot timestamps must equal the receipt instant in PostgreSQL, not
only the value returned by the ORM. This connection setting does not change
server defaults or rewrite existing rows. Before a release against an existing
non-UTC-written database, historical timestamps and immutable receipt digests
require a scoped compatibility check; silently shifting old data is forbidden.

## Identity and transfer contracts

- Project-owned persistence IDs use Prisma `cuid()`; Better Auth tables retain
  provider-generated identifiers.
- Shared cross-project identity uses immutable uppercase ULID `uid` values.
- Public routes reference a 16-character lowercase Crockford Base32
  `publicUrlId`. `PublicUrlIdReservation` binds it to organization, project,
  subject type and subject UID. Rows cannot be updated or deleted, preventing
  reuse after retire/tombstone flows.
- Public transfer objects are created only through the whitelist mapper from
  `packages/data-contracts`; raw Prisma rows are not serializable as public DTOs.
- Transfer contracts carry exact `schemaMajor/schemaMinor` and use canonical
  JSON with recursively sorted object keys.

## Durable operational requests — MP-08 foundation

`OperationalActionRequest` preserves the existing audited request ID and binds
one exact project/action to an IDs-only outbox intent in the same command
transaction. Composite Source/revision/project FKs and an INSERT trigger reject
scope, topic, payload or audit identity mismatches. Private review justification
stays in request/audit, never the queue payload. New requests are REQUESTED;
declared lifecycle states alone are not executor completion.

The web role creates requests only through the admin purpose. The worker can
read with the exact single-project `operations-executor` purpose and update only
lifecycle columns, not immutable identity, subject or intent binding. A SQL
guard validates the full active lease and forbids manufactured results. The ordinary outbox
consumer defers all six reserved operational topics instead of failing them.
Existing 14/30-day settled-intent retention detaches the optional outbox FK
without deleting the durable request or changing its stable idempotency result.
New INSERT still requires an exact existing intent. Existing idempotency expiry
policy remains unchanged; no consumer, credential provisioning or production
operation is activated by this foundation.

The platform-owned `lockOperationalOutboxLease` API uses existing worker
outbox/job privileges to lock and verify the full event/attempt/worker/time/job
tuple under an exact `operations-executor` single-project context. It does not
grant request UPDATE or settle business state. Caller-owned ReadCommitted cuts
must acquire global safety and domain locks before this fence; never hold it
over external IO. Lifecycle now persists RUNNING owner identity and immutable
SUCCEEDED results for the concrete suspicious-rejection adapter. Its domain
review, audit and request completion share one transaction; rejection never
changes inventory or Last GOOD. Replay of an already committed result precedes
mutable freeze/project/revision admission. Policy/analysis JSON is SQL-bounded
before transfer. Only this adapter is registered in the shared queue; the other
five remain reserved. Immutable FAILED carries one finite generic safeErrorCode
and requires actual DEAD_LETTER/latest FAILED JobRun metadata. Retry/defer does
not fail a request; committed success cannot be overwritten. Startup/60s paged
reconciliation survives the fail-before-request crash gap. A purpose-restricted
boolean definer and owner-only SELECT policy work under non-BYPASS FORCE RLS
without opening runtime request reads; deletion is denied for bound unresolved
requests but permits terminal or orphan event retention. Malformed/unbound
intents are skipped without manufacturing request results.

## Confirmed listing-agent assignments

`ListingAgentBinding` is owned by project-state. It binds scoped Source/GOOD
revision, inventory UID and immutable record hash to a scoped Agent UID. Composite
foreign keys enforce tenant ownership; a trigger verifies actual GOOD record
membership. The forward migration is additive and does not backfill inferred
assignments. Missing bindings omit public agent linkage, not inventory.
The `agent-matching` project job alone writes the complete revision set in the
existing command transaction, after DataSafety admission. Snapshot input reads
only; worker is NOBYPASS with FORCE RLS. Public datasets expose only eligible
`agentUid`, never private binding IDs, source pins, hashes or matching evidence.
Rollback means disabling this new consumer/writer and forward-fixing; no
production migration or destructive rollback is performed during remediation.

## Shared catalog geography

`Region → City → District` is the global, reusable geography tree owned by the
`shared-catalog` module. Shared entities use immutable uppercase ULID `uid`
values, normalized Russian names, explicit alias rows and lifecycle
`ACTIVE | INACTIVE | ARCHIVED`. Region codes use ISO 3166-2-style values.

The foundation migration seeds `RU-KDA → Краснодар`, `RU-CR`, `RU-SEV →
Севастополь` and `RU-ROS → Ростов-на-Дону`. Districts are intentionally not
seeded: an operator adds them through the Catalog Admin boundary. Runtime
roles can read the shared tree; only an authorized platform principal can
insert or update it, and runtime roles have no hard-delete grant. Tenant
authentication therefore never implies shared-catalog mutation rights.

## Shared development catalog

`Developer → Development → Building` is the reusable, project-independent
realty hierarchy. `Development` belongs to a `City` and may reference a
`District` only inside that same city. `Building` records the corpus/litera,
floor count, commissioning year and quarter, construction status, material and
housing class. Every entity has an immutable uppercase ULID, explicit aliases,
lifecycle, optimistic `version` and an optional `mergedIntoUid` tombstone.

Create, update, relink and merge operations are available only to a
`platform-admin`. A command changes business rows and appends its
`AuditEvent(source=shared-catalog)` inside one PostgreSQL transaction, so an
audit failure rolls the whole operation back. Merge preserves the old UID as
`ARCHIVED`, relinks dependants to the canonical target and never hard-deletes
catalog history. Database RLS remains a second boundary: tenant principals are
read-only and runtime roles receive no delete grant.

### New-building import foundation

Owner-approved Hub capability as of 2026-10-06 (MP-00.3):
`input → staging → dry-run → reviewed plan hash → explicit manual apply → audit/revision`.
This approval preserves the implemented manual boundary, not an automatic
ingestion permission. Snapshot integration and the final runtime proof are
still owned by MP-05/MP-09 of the remediation plan.

Manual-assisted aggregator collection enters the platform as a bounded,
provider-neutral staging payload. The payload always carries a project-owned
`Source`, its external development identity and `observedAt`; it is first
rendered as a deterministic diff. Persistence is available only through an
explicit confirmation plus the reviewed preview's SHA-256 boundary—there is no scheduler, network
fetch or automatic apply in this foundation.

`Development` owns its normalized public address and coordinate pair.
`DevelopmentExternalIdentity` prevents one provider record from creating
duplicates inside a source scope. `PriceObservation` is append-only evidence
keyed by source object, observation time and price basis. `SharedMediaAsset`
records source URL, order, rights basis, attribution and observation time; a
licensed asset without attribution is rejected. The three import evidence
tables are tenant/project scoped, protected by RLS, and have no runtime
hard-delete grant. Raw feeds, employee phones and provider credentials are not
part of these models.

The public `newbuildingImportCommands.preview/apply` server entrypoint binds
organization and project, locks the source and rejects a stale preview.
Catalog revision, business rows and audit commit atomically. Media URLs must
be public HTTPS without credentials, query strings or fragments; the foundation
does not fetch or mirror media. An existing observation key with changed facts
is a conflict, not an update to price history.

## Platform foundation

### Source runtime revisions — remediation MP-03

`SourceSafetyPolicy` stores a strictly validated, project-scoped policy input.
`SourceRevision` pins configuration version/base Last Good, exact adapter and
profile versions, policy, raw artifact receipt and semantic hash. Its
`SourceRevisionRecord` children hold bounded per-record internal canonical field
state, draft and raw provenance; these are not public DTOs. PENDING records are
durable staging, not applied inventory. SUSPICIOUS/REJECTED evidence remains
persisted without moving Last Good. GOOD records and revision metadata are
immutable, protected by database triggers as well as application checks.

The forward-only `20261007090000_snapshot_good_fact_lookup` migration adds
`SourceRevisionRecord_inventory_fact_idx` on inventory UID, external ID and
record hash. Exact historical GOOD resolution can locate the pinned record
without scanning a source's complete revision history for every identity.
Organization/project/source and GOOD predicates remain in the query; this
index changes neither FORCE RLS nor record immutability or worker grants.

`Source.lastGoodRevisionId` is a composite FK to the same org/project/source's
revision, and the DB requires a GOOD target. A forward migration refuses legacy
dangling pointers rather than inventing history or clearing Last Good.
`InventoryIdentity` remains the stable UID/lifecycle owner across revisions;
new/seen identity mutations and GOOD/Last Good changes occur only in the final
transaction. Initial intake/S3/parsing and staging batches never mutate current
inventory. Missing lifecycle uses bounded 200-identity pages and version-checked
batch updates in the final GOOD transaction. Baseline and empty runs do not
reconcile absence; failed/rejected/suspicious runs do not advance missing grace.
Both missing-run and elapsed-time thresholds must pass before INACTIVATED;
reactivation preserves the original UID. Lifecycle events and Last Good roll
back together on final transaction failure. Persisted Safety Analysis is
recomputed from the pinned policy/counts before planning/apply; STAGED alone is
not approval. Each applied GOOD records a durable `snapshot.build.request`
outbox intent plus audited idempotency marker in the same transaction. The
private payload carries only org/project/source/revision IDs and the Source
revision sequence; it is not a snapshot publish sequence or a publish receipt.
`snapshotTriggered=true` means the intent committed, not that a snapshot was
built/published. Duplicate enqueue for the same GOOD returns the existing event.
An enqueue failure rolls back GOOD, identities, lifecycle events and Last Good;
no remote publication runs in this transaction.

An ACTIVE identity in missing grace may be absent from the newest GOOD feed.
MP-05 snapshot resolution must retain its latest matching GOOD record facts
from revision history (stable UID/normalized hash), not equate the newest feed's
record set with the complete current inventory. INACTIVE identities are excluded
from active listing projection without deleting their source history.

Runtime access uses a scoped `source-import` project-job principal; tenant/client
principals cannot read raw/private revision rows. No delete grant exists for
runtime revision/record tables. Freeze and service/policy changes synchronize
with final apply; all remote IO stays outside DB transactions. The canonical
Source runtime entrypoint is `createSourceExecutionServer(storage).run(scopedIds)`;
storage is server-owned infrastructure, not a Source/job payload dependency.

- `User`, `Session`, `Account`, `Verification` — identity and Better Auth tables;
- `Organization` — tenant boundary;
- `Member` — organization access with `ORG_ADMIN`, `ORG_EDITOR`, `ORG_VIEWER`;
- `Project` — organization-owned project, service state and publication scope;
- `Notification`, `NotificationRead` — user-facing events;
- `AuditEvent` — durable audit trail;
- `IdempotencyKey` — repeat-safe commands;
- `OutboxEvent` — durable async events;
- `JobRun` — job execution records;
- `RuntimeHeartbeat` — worker liveness;
- `RetentionRun` — retention evidence.

## Enums

- system roles: `PLATFORM_ADMIN`, `USER`;
- project status: `ACTIVE`, `PLANNED`, `DISABLED`;
- notification categories: `SYSTEM`, `PROJECT`, `ACCESS`, `QUEUE`.

## Migration Policy

The forward snapshot fact-writer migration acquires the existing global safety
advisory lock in BEFORE STATEMENT INSERT/UPDATE/DELETE triggers on the seventeen
publication-gate fact tables, before PostgreSQL target row locks. It changes no
grants, RLS predicates or field/GOOD immutability guards; MediaAsset stays
append-only for runtime roles. The table set includes selected catalog
Developer/Development/Building lifecycle and merged-parent eligibility, not
live regeneration of names, aliases, geo or prices. Legacy inventory takes global
before its Source domain advisory key. Rollback disables publication admission
and uses a forward fix rather than removing protections or rewriting history.
Only the isolated synthetic database is migrated during this implementation;
production admission and release remain separate.

`SnapshotPublicationBinding` pins one receipt/sequence to its inputHash, keyId,
canonical signed manifest text and exact manifest SHA-256 before object upload.
It has a composite scoped receipt FK, receipt/sequence uniqueness, a 2-MiB text
limit, exact-byte SHA check and immutable/header-correlation trigger. Only the
single-project snapshot-publication worker purpose can SELECT/INSERT; UPDATE
and DELETE are not granted. This purpose gains SELECT-only receipt/part access
and restrictive fact-write denial; snapshot-input permissions are unchanged.
The forward binding migration also corrects ListingAgentBinding's read-policy
name to the canonical `_rls` convention with identical predicates and grants.
Binding/artifact staging is not current publication or fresh consent admission.

`SnapshotArtifactStageReceipt` is the separate immutable metadata proof of
completed BUILD staging, not of publication. It references the scoped binding
and pins the input hash, captured idempotency hash, sequence and manifest hash;
its timestamp is generated by PostgreSQL, not by the caller. The INSERT guard
checks those pins against binding/input, and exact-purpose RLS permits scoped
metadata reads only. Worker gets SELECT/INSERT, never UPDATE/DELETE. Only the
server staging facade records it after fully settled artifact/manifest PUTs
and fresh four-owner admission under global then publication locks. There is
no public caller-metadata receipt writer. A failed or cancelled stage leaves
no receipt/current/DeliveryRun, though the immutable pre-PUT binding may exist.
Exact replay reads metadata without signing, storage IO or mutable admission;
it proves the old BUILD, never authorizes a new PUBLISH. Operational BUILD
request completion now has a concrete two-cut adapter: full RUNNING lease fence
before capture/IO, full success fence after staging, with the SQL guard requiring
the same request-owned key and complete capture request hash (minor zero, input
schema one, db-v1). New stage INSERTs pin that request hash against the input.
The nullable additive column preserves older immutable non-operational receipts
without backfill; a NULL legacy pin cannot satisfy operational BUILD success.
Exact operational replay rechecks the scoped immutable result without config,
capture or PUT. The combined queue registers BUILD only with the existing
SNAPSHOT_BUILD_ENABLED capability; other four unimplemented actions stay reserved.

The forward publication Source-read migration adds exact-purpose scoped SELECT
policies to Source/InventoryIdentity and GOOD-only SourceRevision/Records, with
restrictive scope policies preventing legacy broad job reads for this purpose.
Existing grants and restrictive fact-write denial remain unchanged. The bounded
ingestion reader transfers only head/cohort/historical membership metadata, not
revision payloads, external producer identifiers or live projection settings.
Its caller owns global then scoped publication locks in ReadCommitted; no fact
row/domain locks are acquired. Pre-PUT staging admission is not final publication
admission across object upload; no production migration or release is implied.

The forward publication Project-read migration adds scoped SELECT policies for
Project, ProjectPublicContact, Agent and ListingAgentBinding, plus global safety
state for the exact single-project publication purpose. Restrictive policies
prevent broad legacy project-job reads; grants and fact-write denial stay intact.
Project admission compares active service status, unfrozen jobs, captured contact
version, published Agent consent/version/photo slots and exact captured binding
tuples. It uses value-free receipt anchors and bounded metadata reads, not personal
values, whole Project.version or live graph enrichment. Optional absent contact
addition and unrelated new Agents are allowed. This pre-PUT check must be repeated
by the final post-PUT publisher; no current/run or outbox execution is implied.

The forward publication Catalog-read migration adds exact-purpose SELECT to the
three subscription tables and three shared catalog entity tables. Subscription
scope is organization/project; Developer/Development/Building remain global, and
selected UID restriction is the guarded reader contract, not row-level tenant
ownership. Restrictive policies exclude broad/legacy publication purposes, while
existing grants and write denials remain unchanged. Fresh admission compares full
subscription mode/version/city/decision membership and selected entity lifecycle,
merge and parent/city/district metadata, not values or whole entity versions.
Direct membership writes remain protected by the existing global writer triggers.
No historical migration, catalog data or remote environment is rewritten.

The forward publication Media-read migration adds exact scoped SELECT and
restrictive scope policies to MediaAsset, MediaSource and SharedMediaAsset, without
new grants or write permissions. Media anchors contain only actual HEAD-verified
attachment identity and copied asset/relation/shared permission metadata. Fresh
SQL returns hashes and trim-presence booleans rather than URL/license/attribution
values. Asset/relation/observation IDs are deduplicated for reads in pages of 200;
owner-position attachments stay independent. Current MIRRORED/WARNING eligibility
does not require exact attempt timestamps or relation revision equal to GOOD head.
Inventory/shared private capture now adds relationCanonicalUrlHash; old receipts
lacking a required pin fail closed before HEAD, requiring a new capture identity,
not a historical hash/timestamp rewrite. Raw SQL reassociation with unchanged
updatedAt is detected through the canonical hash. Full post-PUT admission and
atomic publication remain separate; no remote migration or release is implied.

`SnapshotBuildInputPart.payloadByteCount` and `payloadRecordCount` are PostgreSQL
`GENERATED ALWAYS ... STORED` values computed from the immutable JSON payload.
Runtime inserts omit them; explicit forged values are rejected by PostgreSQL.
The forward-only `20261007093000_snapshot_input_generated_sizes` migration uses
these exact values in aggregate budget checks, avoiding repeated JSON serialization
at commit. Both deferred header/part triggers, all 18 sections, contiguous indices,
part/record/byte limits, immutable guards and RLS remain unchanged.

Applied migrations are immutable. Schema changes use additive, reviewed forward
migrations; database rollback requires the isolated recovery contract in
`OPERATIONS.md`. Production migration is a separately authorized release step.

## Tenant Isolation Transition

E03 treats `Organization`, `Member`, `Project`, tenant-scoped notifications, audit, idempotency and async records as an explicit PostgreSQL RLS coverage inventory. A model with tenant data is incomplete until it has a coverage entry, policy and isolation test. The definitive transaction-context, role and composite-key contract is [`ADR-006`](adr/ADR-006-postgresql-tenant-isolation.md).
