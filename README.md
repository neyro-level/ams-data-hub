# AMS Data Hub

Рабочее reference-приложение AMS Data Hub для будущих CRM, аналитических кабинетов и внутренних веб-приложений АМС.

Repository является product-owned приложением с `PROJECT_CLASS = STANDARD` и `DELIVERY_PROFILE = CRITICAL`. Push и Pull Request не расходуют SourceCraft CI; один ручной exact-head Gate предшествует merge, а production выпускается отдельно из exact `main` через SourceCraft Registry.

Внутри уже есть закрытая страница входа, политика обработки данных, приватный shell, Platform Admin, пользователи, организации, роли, проекты, audit trail, idempotency, outbox, worker и Docker/release contracts.

## Что оставлено

- публичная поверхность: `/`, `/politika/`, `/api/health/*`; сайт закрыт от индексации;
- приватная рабочая область: `/dashboard/`;
- администрирование: `/admin/organizations/`, `/admin/memberships/`, `/admin/projects/`, `/admin/operations/`;
- уведомления: `/notifications/`;
- роли: `PLATFORM_ADMIN`, `STAFF`, `MEMBER`;
- PostgreSQL + Prisma baseline;
- Better Auth username/password;

## Что удалено

Предметная вертикаль исходного продукта полностью удалена: внешние провайдеры, отчёты, fixtures и старые provider scripts.

## Быстрый старт

```bash
pnpm install
pnpm prisma:generate
pnpm dev
```

Для локальной базы используйте `.env.example` как шаблон. Перед production должны быть подтверждены юридический текст, секреты, database topology и release решение.

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
