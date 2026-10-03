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
