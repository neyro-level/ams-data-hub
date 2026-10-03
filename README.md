# AMS Data Hub

Рабочее reference-приложение AMS Data Hub для будущих CRM, аналитических кабинетов и внутренних веб-приложений АМС.

Repository является product-owned приложением с `PROJECT_CLASS = STANDARD` и `DELIVERY_PROFILE = CRITICAL`. Push и Pull Request не расходуют SourceCraft CI; один ручной exact-head Gate предшествует merge, а production выпускается отдельно из exact `main` через SourceCraft Registry.

Внутри уже есть публичная главная страница, legal pages, login modal, приватный shell, Platform Admin, пользователи, организации, роли, проекты, audit trail, idempotency, outbox, worker, Docker/release templates и безопасный PWA-слой.

## Что оставлено

- публичный сайт: `/`, `/politika/`, `/soglasie/`, `/cookies/`, `/terms/`;
- приватная рабочая область: `/dashboard/`;
- администрирование: `/admin/organizations/`, `/admin/memberships/`, `/admin/projects/`, `/admin/operations/`;
- уведомления: `/notifications/`;
- роли: `PLATFORM_ADMIN`, `STAFF`, `MEMBER`;
- PostgreSQL + Prisma baseline;
- Better Auth username/password;
- PWA: manifest, standalone mode, offline page, service worker без кеширования приватных маршрутов.

## Что удалено

Предметная вертикаль исходного продукта полностью удалена: внешние провайдеры, отчёты, fixtures и старые provider scripts.

## Быстрый старт

```bash
pnpm install
pnpm prisma:generate
pnpm dev
```

Для локальной базы используйте `.env.example` как шаблон. Перед production у производного продукта должны быть собственные домен, юридические реквизиты, секреты, database topology и release решение.

## Проверки

```bash
pnpm verify:config
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm verify:quick
```

`verify:config` дополнительно проверяет, что старый product vertical не вернулся и PWA не кеширует приватные маршруты.

## Документы

Карта документов: [`docs/README.md`](docs/README.md).

AMS Data Hub сохраняет общие platform boundaries, но владеет собственной доменной моделью, данными, интеграциями, legal и production-профилем.
