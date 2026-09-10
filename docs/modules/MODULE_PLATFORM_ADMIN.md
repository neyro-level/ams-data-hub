# Module: Platform Admin

## Назначение

Защищённая внутренняя поверхность `/admin/*`, которая агрегирует typed owner-module queries/commands, URL state and shared UI.

## Не входит в scope

Ownership of business entities, generic CRUD/dispatcher, Refine, provider credentials and arbitrary Prisma access.

## Data ownership

Static route resources, page query contract and dashboard summary only. Identity, registry and reliability data remain in owner modules.

## Principal types

`platform-admin` only.

## Roles and permissions

Requires fresh active `platform-admin` principal and platform management permissions. Analyst, tenant-user and anonymous principals are denied.

## Commands

Routes call explicit identity/project/operations commands through typed Server Actions; no generic command registry.

## Queries

Owner-module list/detail/options plus admin dashboard summary with allowlisted search/sort/page state.

## DTO

Browser-safe resource rows, form options, pagination and action results; no Prisma records or secrets.

## Invariants

- only fresh PrincipalContext authorizes;
- browser state does not own tenant, audit or correlation metadata;
- client components import browser-safe contracts only;
- shadcn Table + TanStack Table `9.2.4` + nuqs own list presentation/URL state;
- React Hook Form + Zod own form UX; server command validates again;
- provider settings reject sensitive keys;
- public landing does not import admin UI.

## Tenant behavior

Cross-tenant operation names or loads an explicit target organization. Platform Admin never impersonates tenant-user.

## Resource authorization

Owner module loads the concrete resource and validates ownership inside the business transaction.

## State lifecycle

Routes expose explicit loading/empty/error/success/stale states. Entity lifecycle belongs to owner modules.

## Concurrency

Mutable aggregates use optimistic version. Pending UI blocks repeat submission; stale result preserves input.

## Idempotency

Operations enqueue uses Platform Operations idempotency. Ordinary entity writes use version/unique constraints.

## Audit

Every successful mutation writes owner-module AuditEvent in the same transaction.

## Events / Async policy

Only named owner commands may enqueue versioned outbox topics.

## Integrations

No direct external integrations. Admin routes compose Identity Access, Project Registry and Platform Operations APIs.

## Failure behavior

Unauthorized → denial; stale → typed conflict; invalid input → field errors; internal error → stable envelope with correlationId.

## Tests

Principal denial, owner commands/queries, audit atomicity, URL state, forms/tables and browser proof at `375 / 768 / 1280 / 1440`.
