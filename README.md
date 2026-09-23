# АМС Старт

Нейтральный starter для будущих CRM, аналитических кабинетов и внутренних веб-приложений АМС.

Сам repository является copy-source шаблоном с `DELIVERY_PROFILE = EXPERIMENT`: он не имеет production и не расходует SourceCraft CI-минуты на push или Pull Request. Production-контур создаётся только в отдельном производном продукте после hardening.

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

Главная идея упаковки: не делать из starter “пример продукта”. Каждый новый продукт берёт эту базу, затем отдельным stream добавляет свою доменную модель, данные, интеграции, тексты, legal и production-профиль.
