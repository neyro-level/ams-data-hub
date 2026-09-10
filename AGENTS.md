# AMS MicroSaaS Starter — project router

## Project contract

AMS MicroSaaS Starter — отдельный reusable foundation АМС для SaaS, аналитических модулей, кабинетов и mini-CRM. Текущий snapshot сохраняет AMS IMPULSE как рабочий SEO reference vertical; производный продукт заменяет его product-specific scope отдельным stream и не использует runtime, БД, auth, домены или credentials исходного проекта.

`DELIVERY_PROFILE = EXPERIMENT` только пока repository используется как неразвёрнутый starter без реальных пользователей и данных. До подключения клиентов, PII, ценной БД или production обязателен отдельный hardening stream и выбор `COMMERCIAL` либо `CRITICAL`.

Platform contract: `AMS Application Platform Core 3.4 — Solo Minimal`.

```text
TENANCY = multi-tenant
ASYNC = outbox-plus-queue
DATA = pii
DELIVERY = own-saas
PLATFORM_ADMIN = enabled
DATABASE = self-managed-postgresql
```

`DATABASE` описывает сохранённый reference vertical. Производный продукт обязан отдельно подтвердить database topology до первого release и не наследует production exception автоматически.

## Source of truth

- назначение starter и карта документов — `docs/README.md`;
- reference product и роли — `docs/PRODUCT.md`;
- архитектура и profile — `docs/ARCHITECTURE.md`;
- schema/lifecycle/invariants — `docs/DATA_MODEL.md`;
- auth, PII и trust boundaries — `docs/SECURITY.md`, `docs/AUTH.md`;
- environment ownership — `docs/ENVIRONMENT.md`;
- текущий backlog — `docs/MASTER_PLAN.md`;
- release и recovery — `docs/RUNBOOK_DEPLOY.md`, `docs/ops/*`;
- private UI — `docs/INTERNAL_DASHBOARD_DESIGN_SYSTEM.md`;
- public UI, legal и login modal — `docs/EXTERNAL_SITE_DESIGN_SYSTEM.md`;
- соответствие Core 3.4 — `docs/PLATFORM_CONFORMANCE.md`;
- exact versions/runtime — `package.json`, lockfile, `.node-version`, Prisma schema/migrations и runtime config.

Для обычной задачи читать `README.md`, этот router и один профильный документ. Полный Core и весь docs tree подключать только для architecture/security/compliance scope.

## Product invariants

- hierarchy: `Все проекты → Проект → Сайты → Единый отчёт`;
- browser-safe report contract: `SiteReportSnapshot`;
- periods: `week`, `month`, `quarter`, `halfYear`; default `month`;
- `partial ≠ success`, `stale ≠ current`, `null ≠ 0`;
- Webmaster average position не является exact ranking;
- Top-3 входит в Top-10;
- direct query-to-lead attribution запрещена; Topvisor mutations и paid rank checks разрешены только idempotent worker-сценарию onboarding/weekly schedule после обязательного price-check;
- PostgreSQL — единственный runtime source of truth; operator config импортируется только явной private-path командой.

## Hard rules

1. Перед изменением установить checkout, branch, dirty state и actual versions.
2. Объявить `STANDARD` или `RISKY`; независимые scope не смешивать.
3. Browser/URL/form `organizationId` не доказывает tenant access.
4. Canonical identity — server-generated `PrincipalContext`; Platform Admin не получает fake tenant.
5. Authentication не заменяет permission + resource authorization.
6. Prisma запрещён в presentation/domain; global client — только в approved database/infrastructure boundary.
7. Business mutation проходит `defineAction/API/job → defineCommand → transaction-bound repositories`.
8. External HTTP/email/AI/storage запрещены внутри business transaction.
9. Tenant relations защищаются explicit scope и composite PostgreSQL constraints; nested tenant writes запрещены без доказанного исключения.
10. Applied migration не переписывается; production `db push` запрещён; после schema change выполняется explicit Prisma generate.
11. Unknown environment/database target для destructive операции означает fail closed.
12. Better Auth владеет identity/password/session; public signup и Organization Plugin выключены.
13. Пароль ровно из 8 печатных символов назначает Platform Admin через protected UI или stdin-only CLI; fresh session и active User обязательны.
14. Secrets/PII не попадают в Git, browser, argv, docs или logs; provider calls только read-only.
15. Production использует exact reviewed SHA и immutable image; merge не равен release.
16. Private UI следует AMS UI Development Constitution 3.1 и Application Design System 2.1, использует semantic tokens и PT Root UI; `crm-*`, системный HEX в reusable UI и business CSS в `globals.css` запрещены.
17. Public UI остаётся в изолированной `theme-public` с Manrope; landing, legal и modal-вход не редизайнятся без отдельного решения владельца.

## Architecture map

- `src/app`, `src/components` — routes и presentation;
- `src/modules/identity-access` — Membership и auth adapter;
- `src/modules/project-registry` — organizations/projects/sites/configuration;
- `src/modules/reporting` — report reads и единственный compiler;
- `src/modules/ranking-analytics` — ranking semantics;
- `src/modules/data-ingestion` — sync lifecycle и provider orchestration;
- `src/modules/platform-operations` — audit/idempotency/outbox/jobs/readiness;
- `src/modules/platform-admin` — admin composition;
- `src/platform` — neutral auth/authorization/database/actions/commands/config/observability;
- `collector/sources` — server-only read-only provider adapters;
- `src/worker` — compiled worker entrypoint;
- `prisma` — current schema + immutable migrations;
- `ops`, `scripts` — reviewed release/maintenance/verification boundaries.

Cross-module consumers используют только root entrypoints. Runtime pg-boss работает без DDL. Новый topic требует versioned bounded payload, handler, finite retry/dead-letter и tests.

## Solo workflow

```text
один независимый scope
→ новая work/* branch + worktree от origin/main
→ реализация
→ commit + push
→ PR без review/tests/manual CI
→ перед main: full diff review + STANDARD/RISKY exact-head proof
→ merge
→ ancestry check + удалить worktree/local branch
```

Canonical primary — SourceCraft `origin/main`. GitHub — только очищенное manual mirror. Production меняется лишь по отдельной owner-команде.

Основные проверки:

```bash
pnpm verify:quick
pnpm verify:risky
pnpm verify:daily
pnpm verify:release
```

Выбирать минимально достаточный профиль. Integration runner допускает только explicit `*_test` database. UI proof при необходимости: `375 / 768 / 1280 / 1440`.

## Documentation rule

Обновлять только authoritative документ затронутой области. Не создавать архивы, audit reports, worklogs и вторые планы. Выполненные пункты удалять из `docs/MASTER_PLAN.md`; историю хранит Git.
