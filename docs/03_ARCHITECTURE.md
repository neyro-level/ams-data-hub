# Architecture — AMS Data Hub

**Статус:** Active
**Platform contract:** AMS Application Platform Core 3.4 — Solo Minimal

## Delivery and project profile

```text
PROJECT_CLASS = STANDARD
DELIVERY_PROFILE = CRITICAL
TENANCY = multi-tenant
ASYNC = outbox-plus-queue
DATA = pii
DELIVERY = own-saas
PLATFORM_ADMIN = enabled
```

This repository is the product-owned Data Hub reference application derived
from AMS MicroSaaS Starter. Its production identity is
`https://data-hab.ams24.ru`; runtime target is SSH alias `ams-data-hub-deploy`, and
immutable images are published to the organization SourceCraft registry.
Production remains an explicit owner action and never follows a push or Pull
Request automatically.

## Source of truth

| Area | Authoritative source |
| --- | --- |
| Product scope | `01_PRD.md` |
| Screens, routes and flows | `02_PRODUCT_STRUCTURE.md` |
| Architecture, profile, security and data policy | this file and ADRs |
| Current schema and migrations | `prisma/schema.prisma`, `prisma.config.ts`, `prisma/migrations/` |
| Current work | `04_BACKLOG.md`; execution state is local Task Manager `.beads` |
| Release template | `05_RELEASE_CHECKLIST.md`, Docker/Compose and `ops/` |
| Final conformance, handover and rollback | `05_RELEASE_CHECKLIST.md`, `OPERATIONS.md` and ADR-014 |
| Exact versions | `package.json`, `pnpm-lock.yaml`, `.node-version`, Dockerfile |

The detailed `DATA_MODEL.md`, `SECURITY.md`, `ENVIRONMENT.md` and
`OPERATIONS.md` files remain justified extensions. They refine the area named
here and cannot override it. Visual rules belong only to `06_DESIGN_SYSTEM.md`.

## Module Map

The map records implemented module boundaries. Current work and remaining
operator/release decisions are recorded in the backlog and Task Manager.

### Remediation runtime state — MP-00 / 2026-10-06

The module map is foundation evidence, not production readiness. The approved
remediation program preserves these boundaries while connecting them:

- MP-02: outbound feed intake is currently buffered; bounded streaming is pending.
- MP-03/MP-04: import orchestration, source queue and scheduler ports exist,
  but the permanent worker entrypoint currently runs outbox only; concrete
  SourceExecutionService and scheduled source execution are pending.
- MP-05: `composeSnapshot` exists as a composer, not a completed DB-state
  application pipeline. Real 13-dataset projectors, input resolution and
  build/sign/publication orchestration are pending.
- MP-06/MP-07: sanitized HTML/public media corrections and bounded consumer
  decompression are pending; the verifier currently calls unbounded gunzip.
- MP-08: Operations UI records requests; missing executors and HTTP discovery/
  delivery/ACK composition are not represented as completed operations.
- MP-09/MP-10 own complete runtime and readiness proof. Until those gates pass,
  the closed historical v4 is not a PRODUCTION READY claim.

Allowed families are YRL/Vladis, Domclick XML, Avito v3 and CIAN v2. Producer
behavior is `SourceProfile`-owned; format behavior is `SourceAdapter`-owned;
project-specific branching in parser core is forbidden. Family approval is not
production activation. Manual newbuilding staging/reviewed-hash apply remains
the bounded capability in `DATA_MODEL.md`, without automatic ingestion.

| Boundary | State / first slice | Owns | Public boundary |
| --- | --- | --- | --- |
| `identity-access` | active | users, memberships, account setup, authentication administration | `contracts.ts`, `client.ts`, `server.ts`, `index.ts` |
| `project-registry` | active | organizations, projects, memberships and service state | `contracts.ts`, `server.ts`, `index.ts` |
| `platform-operations` | active | audit, idempotency, outbox, jobs and readiness | `contracts.ts`, `server.ts`, `worker.ts`, `index.ts` |
| `notifications` | active; DH-08.3 operational alerts | in-app delivery, feed/read state, scheduled alert detection and owner-delivery port | `actions.ts`, `server.ts`, `index.ts`; real owner recipient adapter stays disabled until configured |
| `platform-admin` | active | platform-wide resource views, summaries and admin queries | `contracts.ts`, `server.ts`, `index.ts` |
| `shared-catalog` | active; DH-03.1 geography foundation | regions, cities, developers, developments, buildings, provenance, revisions and project subscriptions | `contracts.ts`, `server.ts`, `index.ts` |
| `project-state` | active; DH-04/DH-07 | project contacts, agents and consent evidence, editorial fields, URL registry, redirects and lifecycle | project-scoped contracts plus server facade |
| `media-assets` | active foundation; DH-02.5, extended in DH-03 | validated admin intake, rights metadata, hashes, object references and ownership rules | `contracts.ts`, `server.ts`, `index.ts`; storage remains a platform port |
| `snapshot-delivery` | active foundation; DH-05.1–05.7 | deterministic datasets, manifests, signing, publication sequence, project delivery and ACK | composer/signature contracts, server-only SecretRef signer, immutable project storage, current-manifest pointer, persisted `DeliveryRun`, hashed project ACK credential and portable `packages/snapshot-verifier` |
| `ingestion-core` | active; DH-06/DH-07 and marketplace profiles | source registry, adapter/profile contracts, raw and normalized revisions, identity resolution, safety analysis and apply plan | adapter contracts plus project-job worker facade |
| `operations-control` | active; DH-08.1–08.4 | PII-safe fleet projections, idempotent audited operation requests, guarded data-safety controls and protected Exit Bundle orchestration | `contracts.ts`, `server.ts`, `index.ts`; requests do not imply executor completion; alerts go through `notifications` |
| `platform/*` | active platform layer | database, commands, auth, authorization, config, observability, safe outbound and storage ports | platform-owned APIs only |

Dependency direction is `app/components/worker → module public boundary →
application/domain`; infrastructure implements ports and never becomes another
module's public API. Cross-module imports may use only root facade/contract
files. Prisma stays in `platform/database` and module infrastructure. Safe
outbound, object storage and secret resolution remain platform adapters rather
than business modules. External side effects stay outside a business
transaction.

Remote feed and media HTTP is allowed only through
`platform/http/safe-outbound.ts`. The gateway pins the socket to a twice-checked
public DNS result, repeats the same policy after every redirect, bounds total
time and response bytes, and accepts only caller-declared content types. Direct
`fetch`, Node HTTP/TLS clients and alternative HTTP packages in `src` are
rejected by the architecture guard and Dependency Cruiser.

Secret-bearing configuration crosses application boundaries only as a
`SecretRef`. Its server-only resolver reads the value from the environment,
registers it for value-based log redaction and returns a branded server value
only to the consuming adapter. Browser/UI projections contain no reference name
or value. Structured logs additionally redact sensitive keys and complete feed
URLs, including values embedded in message text.

Internal IDs of project-owned tables are Prisma `cuid()` values. Shared entity
`uid` values are immutable uppercase ULIDs. A `publicUrlId` is a 16-character
lowercase Crockford Base32 value reserved per project; reservation rows are
immutable and retained, so an identifier cannot be reused. Better Auth-owned
identity tables keep provider-generated IDs.

`packages/data-contracts` and `packages/realty-contracts` are private,
project-owned workspace packages. They provide strict Zod schemas,
`schemaMajor/schemaMinor`, deterministic canonical JSON and a runtime-branded
public DTO mapper. Downstream delivery uses pinned vendored schema/release
artifacts; package registry publication requires a separate ADR.

## Data, tenancy and async direction

The selected profile is intentional: a shared deployment can serve independent
organizations and needs an explicit tenant principal, server-owned organization
context, scoped repositories, tenant-aware constraints and isolation tests.
RLS is an additional PostgreSQL protection layer, not a replacement for
authorization; its policy and runtime-role design are implemented in E03.

`outbox-plus-queue` is retained because durable business delivery, replay and
integration journaling require durable state. Data Hub owns the worker and
consumer contracts; production enablement follows the explicit release and
operator configuration. Outbox payloads are minimal,
versioned and secret/PII-safe; external delivery is after commit.

## Authentication and provisioning

The supported system roles are `PLATFORM_ADMIN` and `USER`. A `USER` requires
organization membership and an enabled client-access flag. The approved current
release grants Platform Admin authority through a fresh persisted session,
enabled user and `systemRole = PLATFORM_ADMIN`, followed by server-side
permission/resource checks. No TOTP is required by the current policy. OQ-09
is DEFERRED until an explicit post-pilot owner decision. A user with several
memberships must explicitly select the active organization.

The only bootstrap command is `pnpm admin:provision`. It accepts the password
through stdin, creates or resets a `PLATFORM_ADMIN`, revokes existing sessions
without introducing a current-release factor requirement. Account/password
recovery remains protected and audited. Legacy role and bootstrap commands are
transitional only. At this MP-00 checkpoint the existing TOTP plugin, session
gate and factor-specific recovery still exist in code; MP-01 removes them with
a forward migration and auth regressions. This pending implementation does not
override the approved current policy.

## PII lifecycle

| Concern | Data Hub policy | Production obligation |
| --- | --- | --- |
| Inventory | account, membership, audit, notification and configured contact data are PII candidates | add domain fields before production |
| Access | server authorization; Platform Admin is explicit | define role/resource policy |
| Masking and logs | no secrets in browser/logs; avoid unnecessary PII in events | define field-level masking |
| Retention | operation records have retention boundary | set lawful durations and job policy |
| Export/deletion | no generic export/delete API is implied | define product flow and legal basis |
| Audit | security and significant admin operations are auditable | extend action taxonomy |
| Backup | product-owned managed PostgreSQL evidence and release rollback | define retention and complete restore proof before real data |

Legal requirements remain `REQUIRES_CHECK`; this matrix is an engineering
contract, not legal advice.

## Version matrix and verified exceptions

| Area | Installed exact version | Decision |
| --- | --- | --- |
| Node.js | 24.20.0 | Node 24 line; project exact version is pinned |
| Next.js | 16.3.8 | repository-pinned App Router 16.x |
| React | 19.3.0 | repository-pinned React 19 line |
| Prisma / adapter | 7.10.0 / `@prisma/adapter-pg` 7.10.0 | supported PostgreSQL adapter pattern |
| PostgreSQL target | 18 | guarded native integration and isolated restore proof |
| Better Auth | 1.7.7 | repository-pinned 1.7 line; upgrade requires separate verification |
| pg-boss | 12.30.0 | PostgreSQL queue; schema migration/runtime privileges stay separate |
| TypeScript | 6.0.3 | explicit project exception to Core 3.4's 5.9.x hold; no upgrade is implied |

Official compatibility checked on 2026-10-02:

- Next.js 16 upgrade/proxy guidance: <https://nextjs.org/docs/app/guides/upgrading/version-16>;
- Next.js 16.3.8 security release: <https://github.com/vercel/next.js/releases/tag/v16.3.8>;
- React 19.3 stable release: <https://react.dev/blog/2026/09/09/react-19-3>;
- Prisma 7 PostgreSQL adapter: <https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql>;
- Prisma 7/8 release status: <https://www.prisma.io/docs/orm/release-status>;
- Better Auth two-factor plugin: <https://better-auth.com/docs/plugins/2fa>;
- Better Auth 1.7.7 security release: <https://github.com/better-auth/better-auth/releases/tag/v1.7.7>;
- PostgreSQL 18 row security policies: <https://www.postgresql.org/docs/18/ddl-rowsecurity.html>;
- pg-boss runtime and queue contract: <https://github.com/timgit/pg-boss>;
- TypeScript 6 release notes: <https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html>;
- TypeScript 6.0.3 stable release: <https://github.com/microsoft/TypeScript/releases/tag/v6.0.3>.

The TypeScript 6 exception is observational: it is retained because the exact
project toolchain is already pinned and no incompatible API has been found in
this scope. TypeScript 7 is a separate major migration and is intentionally not
mixed into the Next.js security update. A downgrade or further major migration is a separate RISKY task,
not an incidental hardening change.

## ADRs and revisit triggers

- [`adr/README.md`](adr/README.md) is the stable ID and status map.
- ADR-001 fixes the application-platform profile; ADR-005–ADR-011 and ADR-014
  retain the active security/runtime decisions.
- ADR-002, ADR-004 and ADR-013 are explicitly superseded and their IDs are not
  reused.
- ADR-012 retains cache-header, error and observability safeguards; its PWA and
  public-contact clauses were retired by DH-00.5. Revisit TypeScript only
  through a separately approved version task.
- ADR-015 fixes the per-project object-storage boundary. Its provider-level
  credential denial proof is required before an S3 adapter is enabled.
