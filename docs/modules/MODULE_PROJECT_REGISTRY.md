# Module: Project Registry

## Назначение

Управляет `Organization → Project → Site`, provider mappings, goals, tracked queries, profiles и configuration readiness.

## Не входит в scope

Provider HTTP, report compilation, credentials storage, physical project deletion и generic CRUD.

## Data ownership

Organization, Project, Site, ProviderConnection, GoalDefinition, TrackedQuerySet/TrackedQuery, ThresholdProfile и QueryClusterProfile. Prisma schema/migrations own shape; operator config is an explicit private-path import, not a deploy input.

## Principal types

`platform-admin`, `platform-analyst`, `tenant-user`. Job access exists only through explicit worker APIs; api-client is not active.

## Roles and permissions

- platform-admin: global read/write with explicit target organization;
- platform-analyst: global read;
- ORG_OWNER: organization read and allowed project management;
- ORG_MEMBER/VIEWER: organization read only.

## Commands

Typed create/update/status commands for Project and Platform Admin-owned registry aggregates. New mutations use `defineCommand`, transaction-bound repositories and optimistic `version`.

## Queries

Project/site/navigation/monitoring reads and bounded Platform Admin list/detail/form-option queries with allowlisted filters/sorts.

## DTO

Selected project/site/configuration DTOs only; no Prisma records, credentials or raw provider payloads.

## Invariants

- Project belongs to one Organization; Site belongs to the same tenant;
- slug/parent uniqueness follows Prisma constraints;
- enabled site has verified HTTPS URL and approved provider mapping;
- checked-in config contains no secrets;
- runtime reads PostgreSQL, not config JSON;
- `clientSlug/siteSlug` preserve the URL contract;
- replacement disables tracked queries instead of deleting history.

## Tenant behavior

Every tenant-owned row has organizationId. Repository filters and composite foreign keys independently enforce owner consistency.

## Resource authorization

Queries derive scope from PrincipalContext. Mutations load the concrete resource/parent inside the transaction and return not-found-or-forbidden without existence disclosure.

## State lifecycle

Projects: `PLANNED → ACTIVE ↔ DISABLED`; Site/provider/query disable preserves history. Physical deletion is outside ordinary commands.

## Concurrency

Mutable aggregates use positive `version`; stale writes return a stable conflict and commit neither mutation nor audit.

## Idempotency

Seed is repeatable. Deferred project sync uses Platform Operations idempotency + outbox; direct registry mutations rely on explicit version/unique constraints.

## Audit

Every successful registry mutation writes one safe AuditEvent in the same transaction.

## Events / Async policy

Registry writes emit OutboxEvent only when a named command requires deferred work. Provider sync requests use `project.sync.requested`.

## Integrations

No direct provider calls. `pnpm project:add` prepares operator config; only explicit `config:sync --source <private-path> --apply` materializes it.

## Failure behavior

Foreign/missing resource → stable denial; stale version → conflict; invalid relation/slug/settings → stable validation/domain error; no partial write.

## Tests

Permission matrix, tenant isolation, stale conflicts, audit atomicity, tracked-query preservation, migrations, URL state and responsive admin UI.
