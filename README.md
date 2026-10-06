# AMS Data Hub

Рабочее reference-приложение AMS Data Hub для будущих CRM, аналитических кабинетов и внутренних веб-приложений АМС.

Repository является product-owned приложением с `PROJECT_CLASS = STANDARD` и `DELIVERY_PROFILE = CRITICAL`. Push и Pull Request не расходуют SourceCraft CI; один ручной exact-head Gate предшествует merge, а production выпускается отдельно из exact `main` через SourceCraft Registry.

Реализованы закрытый вход, приватный shell, Platform Admin, организации и проекты,
общий каталог, проектное редакционное состояние и агенты, XML-профили и import
safety, signed snapshots/ACK, media mirror, fleet operations, alerts и Exit
Bundle. Платформенная основа включает RLS, audit, idempotency, outbox, worker и
immutable Docker/release contracts.

## Что оставлено

- публичная поверхность: `/`, `/politika/`, `/api/health/*`; сайт закрыт от индексации;
- приватная рабочая область: `/dashboard/`;
- администрирование: `/admin/organizations/`, `/admin/memberships/`, `/admin/projects/`, `/admin/operations/`;
- уведомления: `/notifications/`;
- роли: `PLATFORM_ADMIN`, `USER`; memberships: `ORG_ADMIN`, `ORG_EDITOR`, `ORG_VIEWER`;
- PostgreSQL + Prisma baseline;
- Better Auth username/password;

## Состояние реализации

Утверждённый implementation graph v4 завершён и доставлен в SourceCraft `main`.
Текущий backlog и границы последующих работ — в `docs/04_BACKLOG.md`.
Production rollout остаётся отдельной явной операцией владельца.

## Быстрый старт

```bash
pnpm install
pnpm prisma:generate
pnpm dev:db:status
pnpm dev:start
```

Локальный режим и `.env.local` описаны в `docs/OPERATIONS.md`;
`.env.example` содержит только имена и синтетические примеры. Перед production
нужны legal review, project-only secrets, database topology и release proof.

## Проверки

```bash
pnpm verify:config
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm verify:quick
```

`verify:config` дополнительно проверяет project identity, запрет индексации и минимальную публичную поверхность.

## Документы

Карта документов: [`docs/README.md`](docs/README.md).

AMS Data Hub сохраняет общие platform boundaries, но владеет собственной доменной моделью, данными, интеграциями, legal и production-профилем.
