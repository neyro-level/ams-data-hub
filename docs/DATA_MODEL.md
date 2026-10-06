# Data Model

**Status:** Active extension. `prisma/schema.prisma` and migrations remain the
runtime source of truth; this file is their neutral model map.

Prisma schema is the runtime source of truth.

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
not approval. Transactional snapshot intent remains MP-03.6.

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

Applied migrations are immutable. Schema changes use additive, reviewed forward
migrations; database rollback requires the isolated recovery contract in
`OPERATIONS.md`. Production migration is a separately authorized release step.

## Tenant Isolation Transition

E03 treats `Organization`, `Member`, `Project`, tenant-scoped notifications, audit, idempotency and async records as an explicit PostgreSQL RLS coverage inventory. A model with tenant data is incomplete until it has a coverage entry, policy and isolation test. The definitive transaction-context, role and composite-key contract is [`ADR-006`](adr/ADR-006-postgresql-tenant-isolation.md).
