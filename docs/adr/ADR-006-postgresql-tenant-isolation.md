# ADR-006: PostgreSQL Tenant Isolation And Runtime Identities

**Status:** active; implemented database isolation contract
**Scope:** product-owned multi-tenant + PII database; no production database or credentials are created by this ADR.

## Decision

E03 adds PostgreSQL row-level security (RLS) as defence in depth beneath server-side authorization. Every business transaction establishes a transaction-local, server-owned database authorization context before it reads or mutates a tenant-owned table. Missing, malformed or cross-tenant context is default deny.

Prisma remains the ORM, but does not itself prove tenant isolation. The runtime will use explicit transaction helpers to set local context and repositories will receive a scoped database handle rather than an unrestricted global client for tenant work. PostgreSQL composite ownership constraints protect relations that span tenant-owned records.

RLS does not replace current principal construction, permission checks or resource authorization. Platform-wide operations remain explicit, audited operations; a Platform Admin never receives a fake tenant context.

## Database Authorization Context

The E03 transaction helper establishes these local settings with `set_config` or equivalent `SET LOCAL`, before the first protected query:

| Setting | Meaning | Required for |
| --- | --- | --- |
| `app.principal_kind` | `identity`, `tenant-user`, `platform-admin`, `platform-staff`, `api-client` or `job` | every protected transaction |
| `app.actor_id` | authenticated user, API client or job identity | every protected transaction |
| `app.organization_id` | selected organization identifier | tenant transaction |
| `app.project_ids` | server-owned project allowlist or explicit authorized `*` scope | project-scoped transactions |
| `app.correlation_id` | request/job correlation identifier | every protected transaction |

The helper accepts context only from the server-created `PrincipalContext` or a server-owned job/API credential. URL, form, cookie, queue payload and raw `organizationId` values are not authorization proof. Context lifetime is the single SQL transaction; pooled connections must not retain it after commit or rollback.

`identity` is a deliberately narrow bootstrap context used only while a fresh
authenticated user resolves their own memberships before a tenant principal
exists. Its Member policy is restricted to `app.actor_id`; it cannot read or
write any other protected tenant table.

## RLS Coverage Inventory

| Table | Classification | E03 policy contract |
| --- | --- | --- |
| `Organization` | tenant boundary | tenant users may access only the selected active organization; platform access is explicit |
| `Member` | tenant access grant | selected organization only; membership changes require platform-admin context and audit |
| `Project` | tenant-owned | `organizationId` must equal local context; all reads/writes default deny without it |
| `Notification` | tenant or platform event | tenant rows require matching organization; platform rows are inaccessible to tenant context |
| `AuditEvent` | tenant or platform evidence | tenant rows require matching organization; platform evidence is restricted to explicit platform operations |
| `IdempotencyKey` | tenant or platform command state | organization-scoped rows require match; platform scope is inaccessible to tenant context |
| `OutboxEvent` | tenant or platform async state | organization-scoped rows require match; worker access is constrained to its server-owned job context |
| `JobRun` | tenant or platform async evidence | follows the owning outbox event and its organization context |
| `NotificationRead` | derived access state | access is valid only through an RLS-visible notification and current user identity |

`User`, `Session`, `Account` and `Verification` are Better Auth identity state; their E02 lifecycle rules are preserved and they are not tenant-owned data. `RuntimeHeartbeat` and `RetentionRun` are platform runtime evidence, not tenant records. Their access is limited to designated worker/platform paths and they must not be exposed by tenant repositories.

This table describes the original core policy categories. The current executable
inventory is `src/platform/database/tenant-owned-models.ts`, checked against
Prisma and migrations by `pnpm verify:rls-coverage`; it also includes the
project-scoped Data Hub domain and import evidence models. Adding a model with `organizationId`, a tenant relation, or tenant-visible content requires an entry, RLS policy and PostgreSQL isolation test in the same change.

## Constraints And Roles

1. Relations between tenant-owned records use a composite owner key such as `UNIQUE (organizationId, id)` on the parent and a matching composite foreign key on the child. The existing `Project` composite key becomes the pattern for dependent tenant models.
2. `web` and `worker` runtime roles are separate PostgreSQL logins, do not own application tables, are `NOBYPASSRLS`, and receive only required DML/sequence privileges. `web` receives the identity/session tables and read access to operational heartbeat data required by the application; `worker` receives outbox/job/retention/heartbeat access and no identity-table access. Data Hub names these role contracts `ams_data_hub_web`, `ams_data_hub_worker`, `ams_data_hub_migrator` and `ams_data_hub_backup`; the deployment provisions its credentials outside Git before `migrate deploy`.
3. `migrator` is the only DDL-capable identity. `backup` is read-only and has a separately documented operational privilege set. `test` is dedicated to the disposable `_test` database and may prepare it, never a production target. The local proof creates passwordless structural runtime roles through the native loopback PostgreSQL administrator, then uses `SET ROLE` from the dedicated test identity; no role password is stored or printed.
4. Table ownership, schema migration and role grants are applied by controlled migration/bootstrap SQL. Runtime application identities never acquire owner, superuser, `BYPASSRLS`, `CREATE`, `ALTER` or `DROP` merely to run the app.

## Implementation And Evidence Map

| E03 guarantee | Target implementation | Required evidence |
| --- | --- | --- |
| Missing context denies database access | transaction-context helper sets local values; policies use fail-closed `current_setting(..., true)` handling | PostgreSQL test: no context read/write denied before data access |
| Cross-tenant reads/writes are rejected | RLS policies match `app.organization_id`; repositories use scoped transaction handle | PostgreSQL tests: A reads/writes A allowed, A reads/writes B denied |
| Relations cannot cross tenants | composite unique keys and foreign keys for every tenant relation | migration/ACL test attempts cross-tenant relation and PostgreSQL rejects it |
| Runtime cannot bypass RLS | distinct `web`/`worker` non-owner `NOBYPASSRLS` roles and grants | ACL integration tests verify role attributes and denial outside matching context |
| Every tenant table is covered | checked inventory derived from Prisma schema plus policy manifest | `pnpm verify:rls-coverage` rejects an uncovered tenant model/table |
| Prisma/PostgreSQL usage is compatible | exact installed Prisma/PostgreSQL evidence is checked before raw SQL/helper design | official-doc evidence, generated client and migration review |
| Applied migrations remain immutable | additive forward migrations; never regenerate an applied baseline | clean PostgreSQL 18 migrate/seed/isolation run on dedicated `_test` target |

## Rollout And Stop Conditions

Applied migrations are immutable. Add role/helper contracts and additive
constraints/policies before enforcement; scoped repositories and PostgreSQL
isolation tests must accompany every new protected model.

The product's integration runner invokes a local-only role bootstrap after it
has proved the target is a literal-loopback `*_test` database. The test identity
may bypass RLS only to reset and seed that disposable target; every RLS assertion
switches to a non-owner `NOBYPASSRLS` runtime role first.

Stop immediately if the target database is unknown, the runtime uses an owner, superuser or `BYPASSRLS` identity, a tenant table lacks inventory/policy/test coverage, or an official Prisma/PostgreSQL limitation makes the transaction context non-deterministic. The safe response is a forward design correction, not a live credential or database change.
