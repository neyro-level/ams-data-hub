# AMS MicroSaaS Starter

AMS MicroSaaS Starter — приватная стартовая база АМС для быстрого запуска SaaS, аналитических модулей, кабинетов и mini-CRM.

Текущий baseline является полным code snapshot AMS IMPULSE и сохраняет SEO-аналитику как рабочий reference vertical: готовый пример multi-tenant продукта с auth, Platform Admin, PostgreSQL, очередью, аудитом, публичным лендингом, приватным кабинетом, тестами и release tooling. Производный продукт обязан заменить product-specific документы, branding, интеграции и production identity до первого реального запуска.

Сам starter не является production-приложением и не должен подключаться к данным, доменам, секретам или инфраструктуре AMS IMPULSE.

Проект следует `AMS Application Platform Core 3.4 — Solo Minimal`. Фактические runtime-версии и границы определяют package/lockfile, schema, migrations и versioned конфигурация этого repository.

## Что делает система

- публично представляет предложение по SEO-продвижению и принимает заявки через отдельный AMS Leads API;
- по расписанию получает read-only данные Яндекс.Вебмастера, Яндекс.Метрики и опционально Topvisor;
- сохраняет нормализованную историю и отчёты в PostgreSQL;
- показывает аналитику и клиенту единый директорский отчёт по сайту;
- не изменяет клиентские сайты; Topvisor project/search targets/keywords/rank-check настраиваются только контролируемым idempotent worker-сценарием.

Продуктовая иерархия:

```text
Все проекты
→ Проект
  → Сайты
    → Единый отчёт
```

Внутренние `clientSlug` и маршруты `/c/*` остаются действующим URL/data contract.

## Архитектура

Project Profile: `TENANCY = multi-tenant`, `ASYNC = outbox-plus-queue`, `DATA = pii`, `DELIVERY = own-saas`, `PLATFORM_ADMIN = enabled`, `DATABASE = self-managed-postgresql`. Self-managed PostgreSQL — утверждённый project contract, а не временный этап переезда.

```text
Browser
→ Nginx
→ Next.js standalone
→ application services
→ repository contracts
→ Prisma repositories
→ PostgreSQL

systemd timer
→ worker oneshot
→ provider adapters
→ normalization и domain analytics
→ PostgreSQL
→ ReportSnapshot / SiteReportSnapshot
```

Главные инварианты:

- `SiteReportSnapshot` — единственный browser-safe DTO отчёта;
- Better Auth создаёт session; server-generated `PrincipalContext`, permissions и fresh memberships защищают все приватные reads и mutations;
- browser не обращается к provider APIs и не получает provider credentials;
- UI не импортирует Prisma и не рассчитывает provider semantics;
- PostgreSQL — runtime source of truth; operator config импортируется только явной командой из private path;
- worker отделён от web runtime;
- reliability foundation атомарно связывает idempotency, audit, outbox и JobRun;
- outbox worker uses leases, bounded retry/backoff and dead-letter;
- `partial`, `stale` и `null` не маскируются как `success`, `current` или `0`.

## Реализованные поверхности

Публичные:

- `/` — лендинг AMS IMPULSE;
- `/politika/`, `/soglasie/`, `/cookies/`, `/terms/` — правовые страницы;
- `/robots.txt`, `/sitemap.xml`;
- `/api/health/live` — безопасная liveness-проверка с correlation ID и release SHA.

Приватные:

- `/dashboard/` — входная точка кабинета;
- `/analyst/` — все доступные аналитику проекты;
- `/admin/{resource}/` — protected PLATFORM_ADMIN resources, filters, pagination и audited commands;
- `/c/{clientSlug}/` — сайты проекта;
- `/c/{clientSlug}/{siteSlug}/?period=week|month|quarter|halfYear` — отчёт сайта;
- `/demo/` — авторизованный fixture-отчёт;
- `/api/health/ready` — внутренняя readiness-проверка PostgreSQL + auth + outbox counts с тем же release SHA.

## Стек

Фактические версии закреплены в `package.json` и `pnpm-lock.yaml`:

| Runtime | Current exact version | Статус |
|---|---:|---|
| Node.js | `24.20.0` release; engine `>=24.20.0 <25` | canonical Node 24 |
| pnpm | `11.5.1` | exact |
| Next.js | `16.3.3` | canonical 16.x |
| React / React DOM | `19.2.8` | exact project runtime |
| TypeScript | `6.0.3` | strict |
| Prisma | `7.10.0` | canonical 7.x |
| `@prisma/client` | `7.10.0` | must match Prisma |
| Better Auth | `1.7.2` | identity adapter; Organization Plugin removed from runtime |
| pg-boss | `12.30.0` | canonical outbox/job transport |
| PostgreSQL | `18.x`; local/test `18.6` | canonical 18 |
| Tailwind CSS | `4.3.3` | preserve |
| Zod | `4.5.4` | preserve |

UI следует AMS UI Development Constitution `3.1` и основан на project-owned shadcn primitives поверх Base UI `1.8.0`: внешний слой сохраняет Manrope и изолированную тему `ch-*`, кабинет — PT Root UI и semantic tokens Application Design System `2.1`. Таблицы используют TanStack Table `9.2.4` + shadcn Table, графики — shadcn Chart поверх Recharts `3.10.1`. Refine отсутствует.

## Локальная подготовка

Единственный source of truth для локального запуска — [`docs/ops/LOCAL_DEVELOPMENT.md`](docs/ops/LOCAL_DEVELOPMENT.md). Запросы `запусти локально`, `подними платформу` и `открой локальный кабинет` выполняются по этому runbook.

```bash
pnpm install --frozen-lockfile
pnpm playwright:install
```

Создайте ignored `.env.local` по `.env.example`. Обычный повторный запуск существующего локального контура:

```bash
pnpm dev:status
pnpm dev:start
```

Первичная подготовка дополнительно выполняет `pnpm dev:db:migrate` и `pnpm dev:db:bootstrap`. Native PostgreSQL `18.6` слушает `127.0.0.1:5435` и использует отдельные `seo_monitor_dev` и `seo_monitor_test`. `dev:db:start` проверяет готовность уже установленной Windows-службы, а `dev:db:stop` не останавливает shared PostgreSQL. Docker для обычной локальной разработки не используется. Канонический local URL — `http://127.0.0.1:3001`; полный порядок: [`docs/ops/LOCAL_DEVELOPMENT.md`](docs/ops/LOCAL_DEVELOPMENT.md).

Operator provisioning поддерживает `PLATFORM_ADMIN`, `SEO_ANALYST` и `CLIENT_VIEWER`:

```bash
pnpm user:create -- --username <name> --name <display-name> --system-role PLATFORM_ADMIN
pnpm user:reset-password -- --username <name>
pnpm user:set-system-role -- --username <name> --system-role SEO_ANALYST
```

`user:create` и `user:reset-password` принимают пароль ровно из 8 печатных символов только через stdin. В `/admin/` Platform Admin может одной транзакцией создать organization, project, credential user и Membership; первый вход сразу открывает `/dashboard/`.

## Проверки

```bash
pnpm architecture:check
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm verify:quick
pnpm verify:risky
pnpm verify:daily
pnpm verify:release
```

`test:integration` fail-closed без безопасного `*_test` database, сам применяет migrations и только synthetic test bootstrap. `test:e2e` строит standalone runtime, создаёт только в loopback DB отдельного E2E PLATFORM_ADMIN и проверяет public UI, auth boundary и Admin CMS на 375/768/1280/1440.

`pnpm seed:bootstrap` создаёт только отсутствующие default/reference records и не изменяет существующие business data. `pnpm config:sync -- --source <private-path>` всегда выполняет dry-run; запись разрешена только с дополнительным `--apply`. Deployment не вызывает config sync.

Production web env отдельно проверяется общей Zod boundary:

```bash
pnpm verify:web-environment
```

Production restore smoke выполняется release/deploy pipeline через `ops/postgres/restore-smoke.sh` после подтверждённого offsite backup. Ручной порядок и ограничения описаны в [`docs/RUNBOOK_DEPLOY.md`](docs/RUNBOOK_DEPLOY.md).

Provider preflight и worker sync требуют разрешённого scope и server-side secrets:

```bash
pnpm collector:webmaster:preflight
pnpm collector:metrica:preflight
pnpm worker:sync:all
pnpm worker:outbox:drain
```

## Release

Release собирается из clean reviewed canonical `main` как immutable OCI image вне production host. Один image digest запускает web/worker и explicit migration/maintenance commands; rollout через Docker Compose выполняется после backup/restore proof. Merge сам по себе не изменяет production.

Merge и production deploy выполняются только отдельной командой владельца. Действующий release contract описан в [`docs/RUNBOOK_DEPLOY.md`](docs/RUNBOOK_DEPLOY.md).

## Документация

Начальная точка — [`AGENTS.md`](AGENTS.md).

Активное ядро:

- [`docs/PRODUCT.md`](docs/PRODUCT.md);
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md);
- [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md);
- [`docs/SECURITY.md`](docs/SECURITY.md);
- [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md);
- [`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md);
- [`docs/RUNBOOK_DEPLOY.md`](docs/RUNBOOK_DEPLOY.md);
- [`docs/PLATFORM_CONFORMANCE.md`](docs/PLATFORM_CONFORMANCE.md).

Профильные документы:

- [`docs/TECH_STACK.md`](docs/TECH_STACK.md);
- [`docs/DATABASE.md`](docs/DATABASE.md);
- [`docs/AUTH.md`](docs/AUTH.md);
- [`docs/WORKER.md`](docs/WORKER.md);
- [`docs/SITE_REPORT_IA.md`](docs/SITE_REPORT_IA.md);
- [`docs/EXTERNAL_SITE_DESIGN_SYSTEM.md`](docs/EXTERNAL_SITE_DESIGN_SYSTEM.md);
- [`docs/INTERNAL_DASHBOARD_DESIGN_SYSTEM.md`](docs/INTERNAL_DASHBOARD_DESIGN_SYSTEM.md);
- [`docs/adr/ADR-001-application-platform-profile.md`](docs/adr/ADR-001-application-platform-profile.md);
- [`docs/modules/MODULE_DATA_INGESTION.md`](docs/modules/MODULE_DATA_INGESTION.md);
- [`docs/modules/MODULE_REPORTING.md`](docs/modules/MODULE_REPORTING.md);
- [`docs/modules/`](docs/modules/) — остальные актуальные module contracts;
- [`docs/ops/LOCAL_DEVELOPMENT.md`](docs/ops/LOCAL_DEVELOPMENT.md);
- [`docs/ops/`](docs/ops/).
