# ARCHITECTURE

Platform contract: `AMS Application Platform Core 3.4 — Solo Minimal`.

Delivery Profile: `DELIVERY_PROFILE = EXPERIMENT` для неразвёрнутого starter repository. Перед использованием реальных пользователей, PII, ценной БД или production требуется отдельный hardening stream и переход в `COMMERCIAL` либо `CRITICAL`.

Project Profile: `TENANCY = multi-tenant`, `ASYNC = outbox-plus-queue`, `DATA = pii`, `DELIVERY = own-saas`, `PLATFORM_ADMIN = enabled`, `DATABASE = self-managed-postgresql`.

Это профиль сохранённого AMS IMPULSE reference vertical. Производный продукт подтверждает каждое значение и production database topology до первого release; чужие secrets, data и infrastructure не наследуются.

## System context

```text
Public/private browser
→ host Nginx
→ Next.js App Router standalone web
→ session + server authorization
→ module application query/command
→ repository port
→ Prisma adapter
→ PostgreSQL

scheduled project sync
→ compiled worker command
→ read-only provider adapters
→ normalized evidence
→ PostgreSQL history
→ Reporting compiler
→ ReportSnapshot

client onboarding command
→ transaction: Organization + Project + Sites + User + Membership + SEO core + SearchTargets + OutboxEvent
→ worker: Yandex read-only discovery + Topvisor idempotent setup/price-check/first capture
→ Notification projection + first ReportSnapshot

business command requiring deferred work
→ transaction: business data + AuditEvent + IdempotencyKey + OutboxEvent
→ persistent outbox worker
→ pg-boss
→ idempotent JobPrincipal handler
```

Next.js не является static export. PostgreSQL — единственный runtime data store. Web и worker собираются из одного repository и одного immutable OCI image.

## Module and layer boundaries

Vertical modules содержат `domain / application / infrastructure / presentation` по фактической необходимости. Внешние consumers импортируют только root entrypoints:

- `index.ts` — framework-neutral API;
- `server.ts` — server-only composition/adapters;
- `client.ts` — browser-safe presentation;
- `presentation.ts` — server-rendered presentation;
- `worker.ts` — worker API.

`dependency-cruiser.config.cjs` запрещает циклы, deep imports другого module, Prisma/SQL в presentation, production-to-tests и server dependency в client chain.

## Platform

- `src/platform/auth` — Better Auth identity/password/session adapters и principal session;
- `src/platform/authorization` — discriminated `PrincipalContext`, permissions и factories;
- `src/platform/database` — Prisma client/pool, transaction, scopedDb и tenant registry;
- `src/platform/commands` — business transaction boundary `defineCommand`;
- `src/platform/actions` — transport-only `defineAction`;
- `src/platform/config` — server environment validation;
- `src/platform/http` — correlation, stable error envelope и health DTO;
- `src/platform/observability` — redacted pino logger.

`src/infrastructure/service-container.ts` и `worker-service-container.ts` являются текущими composition roots. Они не владеют business rules.

## Business modules

### Identity Access

Better Auth владеет identity/password/session. AMS владеет Organization, Membership, permissions, resource authorization и административным provisioning.

Все private reads и mutations используют только `PrincipalContext`; compatibility authorization facade удалён и запрещён статическим guard.

### Project Registry

Владеет Organization → Project → Site, provider mappings, goals, tracked query sets, four-way SearchTarget, threshold/cluster profiles, configuration readiness и typed Platform Admin commands.

### Reporting

Владеет report reads, periods и единственным compiler: `src/modules/reporting/domain/report-compiler.ts`. Browser получает validated `SiteReportSnapshot` v1/v2 compatibility payload и tenant-authorized director analytics projections.

### Ranking Analytics

Владеет deterministic query merge, exact/owner position semantics, Top-3/Top-10 и movements. Не зависит от React, Prisma или HTTP.

### Data Ingestion

Владеет `SyncService`, provider ports, sync lifecycle и persistence. Яндекс-клиенты read-only; Topvisor client имеет узкий mutation contract для project/search targets/keywords/checker. Paid operation резервируется до API-вызова в `ProviderOperation`.

### Notifications

Владеет browser-safe лентой, role/tenant visibility, персональным `NotificationRead`, server pagination и unread count. Это проекция lifecycle-событий, а не замена AuditEvent/SyncRun/OutboxEvent.

### Platform Operations

Владеет AuditEvent, idempotency, transactional outbox, pg-boss transport, JobRun, leases, bounded retry/dead-letter, persistent RuntimeHeartbeat, retention и readiness. Dispatch завершается успешным `pg-boss.send`; обработчик позднее принимает только `job.data.event`, поэтому публикация не связана с произвольным немедленным fetch.

### Platform Admin

`/admin/*` агрегирует typed queries/commands владельцев данных. Forms и Next action adapters разделены по bounded resources: sites, providers, goals, tracked queries, thresholds и query clusters; общий слой содержит только transport primitives и safe error mapping. Generic form framework, generic dispatcher, Refine registry и arbitrary Prisma CRUD отсутствуют.

## UI architecture

UI следует `tokens → shadcn primitives → shared application components → module presentation → route composition`.

- `.theme-app` изолирует светлый приватный интерфейс на PT Root UI и semantic tokens Application Design System 2.1; UI-реализация следует AMS UI Development Constitution 3.1;
- `.theme-public` изолирует Manrope и `ch-*` только для landing, legal и modal-входа;
- `src/components/ui` содержит generic project-owned primitives поверх Base UI;
- `src/components/shell`, `dashboard`, `tables`, `charts`, `states` содержат reusable application patterns;
- `src/modules/*/presentation` владеет бизнес-компонентами; `src/app` только композирует route;
- единый private layout получает свежий principal и server-built navigation, а client state владеет только collapse/drawer;
- administrative tables используют общий `AdminDataTable`, server-side URL filter/sort/page и mobile renderer;
- графики используют `AnalyticsCard`, shadcn Chart/Recharts и `chart-*`; report semantics остаётся в reporting domain.

`scripts/verify-ui-conformance.mjs` запрещает возврат `crm-*`, системный HEX в reusable components и business selectors в `globals.css`.

## Canonical data paths

Read:

```text
Server Component
→ server-generated principal
→ module query + resource authorization
→ tenant-aware repository
→ DTO
→ JSX
```

Mutation:

```text
form / Server Action
→ defineAction: fresh session + PrincipalContext + safe error envelope
→ defineCommand
→ permission + resource authorization
→ transaction-bound repositories
→ business mutation + AuditEvent + optional OutboxEvent
→ typed result
→ defineAction revalidation after success
```

Worker:

```text
timer/operator/outbox
→ worker entrypoint
→ module worker API
→ provider/repository adapters
→ PostgreSQL
```

External HTTP, provider calls, email и storage запрещены внутри business transaction.

## Tenancy and authorization

- browser/URL/form `organizationId` не доказывает доступ;
- tenant user создаётся server-side из fresh User + active AMS Membership;
- platform-admin/platform-analyst не получают fake organization;
- permission и module-owned resource authorization обязательны одновременно;
- every tenant-owned record carries `organizationId`;
- composite foreign keys отклоняют cross-tenant parent relations;
- cacheable tenant read принимает organization scope явно;
- tenant scope выбирается только из свежих AMS Membership в детерминированном порядке.

## Reporting and provider invariants

- periods: `week`, `month`, `quarter`, `halfYear`; default `month`;
- `partial != success`, `stale != current`, `null != 0`;
- Webmaster average show position не заменяет exact ranking;
- Top-3 является подмножеством Top-10;
- direct query-to-lead attribution запрещена;
- browser не вызывает Yandex/Topvisor APIs и не получает credentials;
- Topvisor weekly check runs on Monday; competitors run at onboarding and in the first Monday window of each month;
- missing price-check blocks a paid call; ambiguous paid dispatch remains `ACTION_REQUIRED`;
- Яндекс providers остаются read-only; Topvisor writes запрещены вне idempotent worker contract.

## Runtime and release

Repository assets определяют текущий release contract:

- multi-stage non-root `Dockerfile`;
- `docker-compose.production.yml`: persistent web + outbox worker, manual migrate/maintenance;
- host Nginx → loopback web `127.0.0.1:3000`;
- daily project-sync и outbox-retention systemd timers;
- exact image tag/digest и `RELEASE_SHA` в root-owned release env;
- migration container выполняет Prisma deploy и pg-boss schema migration;
- pre-migration backup + offsite confirmation + isolated restore smoke;
- automatic code/assets rollback после failed cutover.

Текущая topology с host networking и self-managed PostgreSQL 18 является утверждённым project exception. БД не публикует `5432` в Internet; runtime/migrator/backup identities, capacity, backup timers и offsite proof проверяются перед release. Managed PostgreSQL для этого проекта — `NOT_APPLICABLE`.

## Executable proof

- `pnpm architecture:check` — import/static boundaries;
- `pnpm test:unit` — domain/contracts;
- `pnpm test:integration` — fail-closed real PostgreSQL;
- `pnpm test:e2e` — standalone/browser flows;
- `pnpm verify:quick` — постоянная дешёвая проверка;
- `pnpm verify:risky` — unit, security integration subset и build для auth/data/tenant/worker/CI/deploy;
- `pnpm verify:daily` — полный integration/E2E/security набор по явному ручному запуску;
- SourceCraft `merge-standard`, `merge-risky` и `release-check` принимают exact requested SHA; push и Pull Request не запускают CI автоматически.

Локальный PASS не заменяет SourceCraft exact-head gate. Production release требует отдельного live proof по `docs/RUNBOOK_DEPLOY.md`.
