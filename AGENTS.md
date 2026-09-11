# AMS MicroSaaS Starter — project router

## Project Contract

`АМС Старт` — reusable foundation АМС для CRM, аналитических кабинетов, внутренних систем и mini-SaaS.

`DELIVERY_PROFILE = EXPERIMENT` пока repository используется как starter без реальных пользователей, production-данных и подключённых клиентов. Перед коммерческим запуском производного продукта нужен отдельный hardening stream и выбор `COMMERCIAL` либо `CRITICAL`.

Platform contract: `AMS Application Platform Core 3.4 — Solo Minimal`.

```text
TENANCY = multi-tenant
ASYNC = outbox-plus-queue
DATA = pii
DELIVERY = own-saas
PLATFORM_ADMIN = enabled
DATABASE = product-defined-postgresql
```

## Source Of Truth

- назначение starter и карта документов — `docs/README.md`;
- продуктовая рамка — `docs/PRODUCT.md`;
- архитектура — `docs/ARCHITECTURE.md`;
- schema/lifecycle/invariants — `docs/DATA_MODEL.md`;
- auth, PII и trust boundaries — `docs/SECURITY.md`, `docs/AUTH.md`;
- environment ownership — `docs/ENVIRONMENT.md`;
- текущий backlog — `docs/MASTER_PLAN.md`;
- release и recovery — `docs/RUNBOOK_DEPLOY.md`, `docs/ops/*`;
- private UI — `docs/INTERNAL_DASHBOARD_DESIGN_SYSTEM.md`;
- public UI, legal и login modal — `docs/EXTERNAL_SITE_DESIGN_SYSTEM.md`;
- exact versions/runtime — `package.json`, lockfile, `.node-version`, Prisma schema/migrations и runtime config.

## Product Invariants

- `АМС Старт` не содержит доменный пример продукта.
- Базовые сущности: User, Organization, Member, Project, Notification, AuditEvent, IdempotencyKey, OutboxEvent, JobRun, RuntimeHeartbeat, RetentionRun.
- `partial ≠ success`, `stale ≠ current`, `null ≠ 0`.
- Public signup выключен; пользователей создаёт Platform Admin или operator CLI.
- Secrets/PII не попадают в Git, browser, argv, docs или logs.
- Service worker не кеширует `/api/*`, `/admin/*`, `/dashboard/*`, `/notifications/*`, auth/session routes и приватные данные.

## Architecture Map

- `src/app`, `src/components` — routes и presentation;
- `src/modules/identity-access` — auth adapter, users, roles, memberships;
- `src/modules/project-registry` — neutral project registry;
- `src/modules/platform-operations` — audit/idempotency/outbox/jobs/readiness;
- `src/modules/platform-admin` — admin navigation and dashboard summary;
- `src/modules/notifications` — notification center;
- `src/platform` — neutral auth/authorization/database/actions/commands/config/observability;
- `src/worker` — neutral worker entrypoint;
- `prisma` — neutral schema and single initial migration;
- `ops`, `scripts` — reusable release/maintenance/verification boundaries.

## Hard Rules

1. Перед изменением установить checkout, branch, dirty state и actual versions.
2. Для schema/auth/runtime/import-boundary изменений считать scope `RISKY`.
3. Authentication не заменяет permission + resource authorization.
4. Business mutation проходит `defineAction/API/job → defineCommand → transaction-bound repositories`.
5. External HTTP/email/AI/storage запрещены внутри business transaction.
6. Applied migration не переписывается в зрелом производном продукте; этот starter допускает squash только до production.
7. Legal TODO-реквизиты заменить до публикации.
8. Производный продукт не наследует production-домен, secrets, database или deploy host.

## Checks

```bash
pnpm verify:quick
pnpm verify:risky
pnpm verify:daily
pnpm verify:release
```

Выбирать минимально достаточный профиль. UI proof при необходимости: `375 / 768 / 1280 / 1440`.
