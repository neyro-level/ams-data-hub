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

## Neutral Foundation

- `User`, `Session`, `Account`, `Verification` — identity and Better Auth tables;
- `Organization` — tenant boundary;
- `Member` — user access to organization with `ORG_OWNER`, `ORG_MEMBER`, `VIEWER`;
- `Project` — neutral starter entity inside organization;
- `Notification`, `NotificationRead` — user-facing events;
- `AuditEvent` — durable audit trail;
- `IdempotencyKey` — repeat-safe commands;
- `OutboxEvent` — durable async events;
- `JobRun` — job execution records;
- `RuntimeHeartbeat` — worker liveness;
- `RetentionRun` — retention evidence.

## Enums

- system roles: `PLATFORM_ADMIN`, `STAFF`, `MEMBER`;
- project status: `ACTIVE`, `PLANNED`, `DISABLED`;
- notification categories: `SYSTEM`, `PROJECT`, `ACCESS`, `QUEUE`.

## Migration Policy

The neutral initial migration is followed by forward hardening migrations while
this starter has no production database. A derived production product must stop
squashing applied migrations.

## Tenant Isolation Transition

E03 treats `Organization`, `Member`, `Project`, tenant-scoped notifications, audit, idempotency and async records as an explicit PostgreSQL RLS coverage inventory. A model with tenant data is incomplete until it has a coverage entry, policy and isolation test. The definitive transaction-context, role and composite-key contract is [`ADR-006`](adr/ADR-006-postgresql-tenant-isolation.md).
