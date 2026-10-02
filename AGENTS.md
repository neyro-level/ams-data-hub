# AMS Data Hub — project router

## Scope

`AMS Data Hub` is the product-owned reference application derived from AMS
MicroSaaS Starter. It is deployed as a working baseline for CRM, analytics
workspaces, internal systems and future MicroSaaS products.
Read the narrowest applicable source before changing code or documentation.

## Reading order

1. `docs/README.md` — document map;
2. `01_PRD.md`, `02_PRODUCT_STRUCTURE.md`, `03_ARCHITECTURE.md` — only the
   scope-relevant sections;
3. one applicable ADR or detailed extension;
4. `04_BACKLOG.md` and the claimed Task Manager task;
5. `package.json`, lockfile, `.node-version`, Prisma schema/migrations and
   runtime config — actual technical state.

## Local invariants

- Keep the application domain-neutral while preserving the Data Hub production
  identity and project-owned infrastructure boundaries.
- Authentication does not replace server-side permission and resource checks.
- Business mutation follows action/API/job → command → transaction-bound
  repositories; external side effects are outside the transaction.
- Secrets and PII never enter Git, browser, logs, argv or docs.
- Service worker never caches auth, API or private routes.
- Schema/auth/tenant/runtime/CI changes are RISKY; use the project scripts and
  record only actual evidence.

## Delivery

`PROJECT_CLASS = STANDARD`; `DELIVERY_PROFILE = CRITICAL`. Push and Pull Request
remain zero-CI. Merge requires one manual exact-head RISKY gate, and production
requires one explicit exact-main SourceCraft release with immutable registry
digests and live proof.

## Checks

Use the smallest relevant script from `package.json`; common verification
profiles are `pnpm verify:quick`, `pnpm verify:risky`, `pnpm verify:daily` and
`pnpm verify:release`.
