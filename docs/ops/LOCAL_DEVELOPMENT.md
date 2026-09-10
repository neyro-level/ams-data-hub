# LOCAL DEVELOPMENT

## Контур

Канонический local mode для AMS IMPULSE — Windows-native checkout + Windows-native PostgreSQL `18.6`.

- bind: `127.0.0.1`;
- canonical host port: `5435`;
- databases: `seo_monitor_dev`, `seo_monitor_test`;
- identities: `seo_monitor_local` for development and `seo_monitor_test` for tests;
- PostgreSQL service: `postgresql-x64-18`, shared by local projects but isolated by roles/databases;
- production credentials запрещены;
- production data допускаются только как явно разрешённый владельцем одноразовый snapshot для локальной UI/QA-работы: без provider secrets, с отзывом перенесённых sessions/verification tokens, отдельным local auth secret и локальной резервной копией перед restore.

## Подготовка

1. Скопировать `.env.example` в ignored `.env.local`.
2. Сгенерировать отдельные local-only `LOCAL_POSTGRES_PASSWORD`, `TEST_DATABASE_PASSWORD` и `BETTER_AUTH_SECRET`.
3. Оставить `APP_ENV=development`; заполнить matching `DATABASE_*` для `seo_monitor_dev`/`seo_monitor_local` и `TEST_DATABASE_*` для `seo_monitor_test`/`seo_monitor_test`.
4. Не коммитить `.env.local` и не печатать значения.

## Database lifecycle

```bash
pnpm dev:db:start
pnpm dev:db:status
pnpm dev:db:migrate
pnpm dev:db:bootstrap
pnpm dev:db:stop
```

`dev:db:start` и `dev:db:status` проверяют реальное подключение, database, role и server version без вывода пароля. `dev:db:stop` намеренно не останавливает shared Windows service. Docker Desktop/Compose не запускаются для обычной local development.

## Application

```bash
pnpm dev:start
```

`dev:start` сначала проверяет native PostgreSQL и локального `superadmin`, безопасно переиспользует уже работающий AMS IMPULSE либо запускает Next.js в скрытом процессе. Next.js читает `.env.local`. Канонический local URL: `http://127.0.0.1:3001`. Порт `3000` не освобождать принудительно: он может принадлежать другому проекту.

`next.config.ts` явно задаёт `agentRules: false`: Next.js не создаёт и не дописывает agent-файлы при старте. Launcher сохраняет исходный tracked `next-env.d.ts` после автоматической dev-генерации, поэтому обычный запуск не должен менять Git state.

## Повторный быстрый запуск

Фраза владельца `подними AMS IMPULSE локально` означает для AI следующий сценарий без дополнительных вопросов:

1. перейти в canonical checkout и проверить `main`, `origin/main` и dirty state;
2. выполнить `pnpm dev:status`, затем `pnpm dev:start`; использовать только native PostgreSQL `18.6` и `seo_monitor_dev` на `127.0.0.1:5435`;
3. launcher проверяет `http://127.0.0.1:3001/api/health/live` и принимает только сервис `ams-seo-monitor`;
4. если AMS IMPULSE уже отвечает — launcher переиспользует процесс; если порт свободен — запускает Next.js в скрытом локальном процессе;
5. если `3001` занят другим приложением — остановиться и назвать владельца процесса, не завершать его автоматически;
6. проверить наличие активного пользователя `superadmin` с ролью `PLATFORM_ADMIN`; обычный запуск не меняет password hash и sessions;
7. открыть `http://127.0.0.1:3001/analyst` в постоянном browser profile, войти и подтвердить реальный приватный экран с проектами/данными;
8. не считать запуск завершённым только по открытому порту или публичной странице.

Canonical username: `superadmin`. Пароль не записывается в документацию и не передаётся через argv. Если сохранённая browser session недействительна, значение берётся без печати из Doppler `ams-seo-monitor/prd`, secret `AMS_SEO_MONITOR_SUPERADMIN_PASSWORD`, и вводится только в password field. Reset выполняется лишь при доказанной проблеме с credential, а не при каждом запуске.

Текущий `seo_monitor_dev` может содержать owner-approved production snapshot для настройки интерфейса. Это локальная копия, а не синхронизация: её дату и актуальность всегда проверять отдельно; не запускать автоматический refresh из production.

Auth user создаётся Platform Admin UI или operator CLI с одной из versioned roles: `PLATFORM_ADMIN`, `SEO_ANALYST`, `CLIENT_VIEWER`. Пароль ровно из 8 печатных символов передаётся CLI только через stdin; argv, hardcoded password и local auth bypass запрещены. Первый вход сразу открывает `/dashboard/`.

## Tests

Unit tests не требуют DB и не содержат skipped integration suites:

```bash
pnpm test:unit
```

Integration runner:

```bash
pnpm test:integration
```

Runner:

1. читает existing process env или ignored `.env.local`;
2. требует полный `TEST_DATABASE_*` contract;
3. отклоняет database без suffix `_test`, недедицированную test identity и совпадение с local identity;
4. применяет immutable migrations только к test DB;
5. выполняет synthetic test bootstrap;
6. запускает пять real-PostgreSQL suites.

Production DB name отклоняется до соединения.

Seed/config commands перед соединением печатают только безопасный target summary без URL и пароля. Prisma migration commands без явного `DATABASE_URL` завершаются ошибкой; `prisma:generate` остаётся доступным без DB.

## Browser E2E

Один раз:

```bash
pnpm playwright:install
```

Затем:

```bash
pnpm test:e2e
```

Команда строит production-like standalone runtime и проверяет public UI/auth boundary на 375, 768, 1280 и 1440 px.

## Verification

```bash
pnpm architecture:check
pnpm verify:quick
pnpm verify:risky
pnpm verify:daily
```

`verify:risky` и `verify:daily` требуют уже запущенную isolated test DB; `verify:daily` дополнительно требует Playwright Chromium и Semgrep.
