# **AMS Data Hub — Implementation Master Plan**

```text
Plan ID: AMS-DATA-HUB-IMPLEMENTATION-2026-01
Architect version: v0
Status: DRAFT
Phase: ASSEMBLY
Baseline repository SHA: 6246a2fa26ed8aaae629f891d6c64d07c0f8a96f
Revision input: OWNER-2026-10-03-01
Canonical working file: docs/AMS Data Hub Master Plan v1.md
Architecture input: docs/00_CONSTITUTION.MD.md (v3.1.2 provided basis)
Task Manager import: NOT ALLOWED
Developer handoff: NOT ALLOWED
Production: NOT AUTHORIZED
```

> Architect guard: загруженная основа принята только как `v0 DRAFT`.
> Раздел «Стартовая инструкция для Codex» не разрешает реализацию, пока exact
> version не прошла финальный audit, не получила статус
> `READY_FOR_OWNER_APPROVAL` и владелец явно не сказал «План утверждён».

**Файл в репозитории:** `docs/04_IMPLEMENTATION_PLAN.md`  
 **Архитектурный канон:** `docs/00_CONSTITUTION.md` (AMS Data Hub Final Master Plan v3.1.2, копируется без изменений)  
 **Продакшн:** `https://data-hab.ams24.ru`  
 **Канонический git:** SourceCraft (`integrator-p/ams-data-hub`)  
 **Инфраструктура:** сервер Timeweb Cloud, managed PostgreSQL Timeweb, S3 Timeweb, секреты в SecretMaster, образы в SourceCraft Registry  
 **Владелец и оператор ПДн Hub:** ИП Скрицкая Юлия Викторовна, ИНН 231295699557, ОГРНИП 323237500365055, integrator-p@yandex.ru  
 **Модель разработки:** solo owner \+ Codex

---

## **0\. Как читать и исполнять план**

### **0.1. Иерархия документов**

Если документы расходятся, действует такой приоритет: `00_CONSTITUTION.md` → этот план → ADR → остальные документы. План не меняет архитектуру, он задаёт порядок работ. Если задача противоречит конституции, Codex останавливается и спрашивает владельца.

### **0.2. Нумерация**

Эпики плана называются `DH-00…DH-10`. Номера `E00…E36` в скобках — ссылки на эпики конституции. Старые номера E00–E11 из hardening-плана стартера больше нигде не используются.

### **0.3. Git-цикл эпика (один эпик \= один PR)**

Подробности в навыках владельца и каноне SourceCraft. Codex перед стартом читает `AGENTS.md` и skills владельца по выводу в `main`. Кратко цикл выглядит так:

1. Начать с актуального `main`: `git checkout main && git pull`.  
2. Создать ветку `epic/dh-XX-<slug>`.  
3. Задачи эпика делать отдельными коммитами `dh-XX.N: <описание>`. Промежуточных PR нет.  
4. Перед PR прогнать локально `pnpm verify:risky` (для эпиков без изменений схемы и auth достаточно `pnpm verify:quick`) и записать фактические результаты в описание PR.  
5. Открыть один Pull Request в SourceCraft и запустить один ручной exact-head RISKY gate.  
6. После зелёного gate и одобрения владельца — merge в `main`.  
7. Удалить удалённую ветку, затем локальную (`git branch -D epic/dh-XX-…`), выполнить `git checkout main && git pull`.  
8. Обновить `docs/05_DELIVERY_STATE.md`: статус эпика, SHA merge, доказательства.  
9. Продакшн-релиз выкатывается только по явной команде владельца: SourceCraft `release` для точного SHA `main`, deploy по `image@sha256`, live-проверка.  
10. Только после этого открывается следующий эпик.

Эпики специально крупные, чтобы проверок было меньше. Внутри эпика без gate.

### **0.4. Общие правила для Codex**

* Никаких `if (projectId === …)` и брендов клиентов в core-коде.  
* Секреты, URL фидов, пароли и ПДн не попадают в Git, логи, argv, docs и fixtures.  
* Мутации идут по цепочке action/API/job → command → транзакционный репозиторий. Внешние побочные эффекты выполняются вне транзакции.  
* Каждая новая таблица классифицирована по RLS (§51 конституции), закрыта политикой и тестом изоляции.  
* Публичные DTO строятся только через whitelist-маппер. Prisma-строки наружу не отдаются.  
* Количества из фида Bastion — evidence, а не контракт.

---

## **1\. Текущее состояние (аудит на `6246a2f`)**

**Что есть и переиспользуется:** Better Auth (вход по логину без регистрации), PostgreSQL RLS с транзакционным контекстом `set_config`, composite FK по организации, команды с аудитом и идемпотентностью, outbox \+ pg-boss \+ worker, образы web/worker/migrator, release по digest, ручной gate SourceCraft, dependency-cruiser, Semgrep, unit/integration/E2E тесты.

**Чего нет совсем:** весь домен Data Hub — каталог, агенты, источники, YRL, inventory, URL Registry, snapshot, подпись, delivery, Exit Bundle, Operations UI.

**Найденные дефекты** (исправляются в DH-01 и DH-02):

| \# | Дефект | Где исправляется |
| ----- | ----- | ----- |
| B1 | Роль STAFF имеет кросс-тенантную запись (включая `Member`) без MFA | DH-01 |
| B2 | RLS изолирует только по `organizationId`, изоляции Project нет | DH-01 |
| B3 | Экспортируется `runInDatabaseTransaction` без auth-контекста — обход | DH-01 |
| B4 | Notification policy не учитывает `visibility` | DH-01 |
| B5 | `take: 100` в `listFormOptions` и `listProjectTrees` молча обрезает списки | DH-01 |
| B6 | Несколько membership без `activeOrganizationId` дают `CABINET_USER_INACTIVE` | DH-01 |
| B7 | `findProjectForAction` ищет без `organizationId` (держится только на RLS) | DH-01 |
| B8 | `session.id` попадает в `correlationId` | DH-01 |
| B9 | `auth` инициализируется при импорте модуля | DH-01 |
| B10 | Healthcheck worker `process.kill(1,0)` при `init: true` всегда зелёный | DH-02 |
| B11 | `env_file required: false` — контейнер стартует без секретов | DH-02 |
| B12 | `apt-get upgrade` в runtime-слое ломает воспроизводимость образа | DH-02 |
| B13 | `pino` не закреплён точной версией | DH-02 |
| B14 | Миграция RLS требует заранее созданных ролей БД, bootstrap отсутствует | DH-02 |
| B15 | Два runtime-контура (`ops/systemd` и compose), outbox может обрабатываться дважды | DH-02 |
| B16 | `NEXT_PUBLIC_CONTACT_*` — форма лидов, которой в Hub быть не должно | DH-00 |

---

## **2\. Решения владельца, зафиксированные планом**

| Тема | Решение |
| ----- | ----- |
| Репозиторий | Этот репозиторий и есть AMS Data Hub. Нейтральность и следы стартера удаляются полностью |
| Тенанты | Organization \= агентство-клиент. Project \= сайт клиента, 1…N на организацию |
| Вход | Логин \+ пароль. Регистрации нет, 2FA выключена (код TOTP остаётся под флагом `ADMIN_TOTP_REQUIRED=false`). Обязательны rate limit, блокировка после серии неудачных попыток, аудит входов. Пересмотр через 2–3 месяца (OQ-09) |
| Роли сейчас | Только `PLATFORM_ADMIN`: владелец и помощник, у каждого своя учётка. Роль STAFF удаляется |
| Роли потом | Модель доступа клиентов строится сразу (организационные и проектные роли, матрица прав, RLS), но UI клиентского входа выключен флагом `CLIENT_ACCESS_ENABLED=false` |
| Каталог новостроек | Полноценный, ручной ввод через Hub Admin. Seed: Краснодарский край (Краснодар), Республика Крым, г. Севастополь, Ростовская область (Ростов-на-Дону). XML новостроек подключается позже тем же YRL-адаптером |
| Вторичка | YRL-фиды, первый — Bastion (`yrl-realty-2010` \+ `vladis-vt24-v1`) |
| Публичная часть Hub | Только страница входа (текущий дизайн сохраняется), `/politika/` и подвал с реквизитами. Hub закрыт от индексации |
| Сайт REALTY LITE | Вне scope. Hub поставляет контракты, snapshot и эталонный тестовый потребитель |
| Инфраструктура | Timeweb (сервер, PostgreSQL, S3) \+ SecretMaster. Канонический runtime — Docker Compose с образами из SourceCraft Registry |

---

## **3\. Карта эпиков**

| Эпик | Название | Конституция | RISKY |
| ----- | ----- | ----- | ----- |
| DH-00 | Канон, очистка, публичная поверхность | E00 | да (удаление кода) |
| DH-01 | Доступ, тенанты, RLS v2, исправление дефектов | E01, E03 (частично) | да |
| DH-02 | Платформенные сервисы и Data Safety Gate | E02, E03, E04 | да |
| DH-03 | Shared Catalog новостроек | E06, E07, E08, E09 | да |
| DH-04 | Project State: редактура, URL, lifecycle, контакты, агенты | E10, E11, E22, §28, §32A | да |
| DH-05 | Snapshot, подпись, доставка, ACK | E05, E12, E13, E15 (Hub-сторона) | да |
| DH-06 | Ingestion core: источники, адаптеры, YRL, inventory, safety | E17–E21, E24 | да |
| DH-07 | Bastion: профиль, фикстуры, агенты, медиа, end-to-end | E23, E25–E29 | да |
| DH-08 | Operations UI, алерты, Exit Bundle | E14, E16, E31 | да |
| DH-09 | Pilot Release Gate и go-live | E30 (Hub-сторона), E32 | да |
| DH-10 | Второй фид и мультиисточники (по триггеру) | E33–E36 | да |

Критический путь: DH-00 → DH-01 → DH-02, затем DH-03 и DH-04 можно вести последовательно в любом порядке, потом DH-05 → DH-06 → DH-07 → DH-08 → DH-09. Каталог новостроек (DH-03) идёт раньше Bastion: его можно начинать заполнять вручную сразу после merge.

---

## **DH-00 — Канон, очистка, публичная поверхность**

**Цель:** репозиторий выглядит и читается как AMS Data Hub, без следов шаблона. Публичная часть сведена к входу, политике и подвалу.

### **Задачи**

**dh-00.1 — Новый канон документов.** Итоговая структура:

| Файл | Роль |
| ----- | ----- |
| `AGENTS.md` | короткий router для Codex: порядок чтения, инварианты, git-цикл, команды проверок |
| `README.md` | что это за продукт, как запустить локально, ссылки на docs |
| `docs/00_CONSTITUTION.md` | v3.1.2 без изменений |
| `docs/01_PRODUCT.md` | продукт, пользователи, scope V1, роли сейчас и потом, экраны и маршруты Hub Admin |
| `docs/02_ARCHITECTURE.md` | модули, границы, профиль платформы, RLS-классы, async, стек и источник версий (lockfile) |
| `docs/03_DATA_MODEL.md` | карта моделей Prisma по модулям и RLS-классам |
| `docs/04_IMPLEMENTATION_PLAN.md` | этот план |
| `docs/05_DELIVERY_STATE.md` | статус эпиков, SHA, доказательства, открытые риски |
| `docs/SECURITY.md` | доверительные границы, ПДн, секреты, подпись snapshot, вход |
| `docs/OPERATIONS.md` | деплой, релиз, rollback, backup/restore, ротации ключей, инциденты |
| `docs/ENVIRONMENT.md` | реестр переменных окружения без значений |
| `docs/DESIGN_SYSTEM.md` | единые UI-правила Admin и страницы входа |
| `docs/contracts/` | описание snapshot-контрактов и Exit Bundle |
| `docs/adr/` | только действующие ADR |
| `CHANGELOG.md` | история изменений продукта с v0.1.0 |

**dh-00.2 — Удалить без архива** (история остаётся в Git): `docs/MASTER_PLAN.md`, `docs/MASTER_PLAN.inventory.json`, `docs/DERIVATION.md`, `docs/HANDOVER.md`, `docs/PRODUCT.md`, `docs/ARCHITECTURE.md` (legacy), `docs/01_PRD.md`, `docs/02_PRODUCT_STRUCTURE.md`, `docs/04_BACKLOG.md`, `docs/05_RELEASE_CHECKLIST.md` (полезное перенести в `OPERATIONS.md`), `docs/AUTH.md` (перенести в `SECURITY.md`), `docs/RUNBOOK_DEPLOY.md` и `docs/ops/*` (влить в `OPERATIONS.md`), `docs/EXTERNAL_SITE_DESIGN_SYSTEM.md` и `docs/INTERNAL_DASHBOARD_DESIGN_SYSTEM.md` (влить в `DESIGN_SYSTEM.md`), `starter.identity.json`, а также скрипты и package-команды derivation и clean-room: `derive:smoke`, стартерные части `verify:conformance` и связанные с ними тесты.

**dh-00.3 — Ревизия ADR.** Действующие решения (профиль платформы, RLS ADR-006, async, release по digest) переписать как ADR Data Hub и перенумеровать `ADR-001…`. Стартерные ADR (нейтральность, derivation, handover) удалить.

**dh-00.4 — Зачистка кода и конфигов от следов шаблона.** Убрать упоминания `starter`, `MicroSaaS`, `copy-source`, `derived`, `neutral`, `derivation` из кода, комментариев, скриптов, `.semgrep.yml`, dependency-cruiser, тестов и package.json. Добавить guard `scripts/verify-no-template-traces.mjs` и включить его в `verify:quick`. Исключение — только `CHANGELOG.md` (запись «initial import»).

**dh-00.5 — Публичная поверхность.**

* Оставить: `/` (страница входа, текущий дизайн), `/politika/`, `not-found`, `error`.  
* Удалить: `/soglasie/`, `/cookies/`, `/terms/`, `/offline/`, `manifest.ts`, service worker, PWA-ассеты и тесты, `sitemap.ts`, лендинговые блоки, `NEXT_PUBLIC_CONTACT_*` и код формы контактов (B16).  
* `robots.ts`: `Disallow: /`. Во всех layout добавить `noindex, nofollow`.  
* Подвал: «© AMS · ИП Скрицкая Юлия Викторовна · ИНН 231295699557 · ОГРНИП 323237500365055 · integrator-p@yandex.ru · Политика обработки персональных данных».  
* `/politika/`: единая «Политика обработки персональных данных и конфиденциальности» с реквизитами оператора. Разделы: категории данных (учётные данные пользователей Hub, рабочие контакты агентов клиентов, данные из фидов клиентов), цели, правовые основания, роль Hub как обработчика по поручению агентств для данных их фидов, сроки хранения, меры защиты, хранение на серверах в РФ, cookie (только технически необходимые сессионные), права субъектов, контакт. Текст пометить как требующий юридической проверки владельцем.

**dh-00.6 — Идентичность продукта в приложении.** `appName`, метаданные, title, favicon — «AMS Data Hub». Домен `data-hab.ams24.ru` вынести в одну конфигурацию.

**dh-00.7 — Модули по конституции (§50).** Создать пустые каркасы модулей с `README` о границе: `catalog`, `catalog-history`, `project-catalog`, `project-catalog-links`, `agents`, `source-registry`, `ingestion`, `project-editorial`, `project-contacts`, `project-urls`, `lifecycle`, `snapshots`, `deliveries`, `media`, `platform-operations`. Добавить правила dependency-cruiser между модулями. Модуль `notifications` оставить как канал алертов.

### **Приёмка**

* `pnpm verify:quick` зелёный. Guard «нет следов шаблона» зелёный.  
* В docs ровно один authoritative документ на каждую область.  
* Публично доступны только `/`, `/politika/`, `/api/health/*`. Остальное отдаёт 404 или требует входа.  
* Сборка, unit- и E2E-тесты (обновлённые) проходят.

---

## **DH-01 — Доступ, тенанты, RLS v2, исправление дефектов**

**Цель:** простой надёжный вход для администратора и модель изоляции Organization → Project, готовая к клиентскому доступу.

### **Задачи**

**dh-01.1 — Роли.**

* `SystemRole`: `PLATFORM_ADMIN`, `USER`. STAFF удаляется (B1), с миграцией существующих записей.  
* Роли в организации (`Member`): `ORG_ADMIN`, `ORG_EDITOR`, `ORG_VIEWER` (переименование текущих ORG\_OWNER/ORG\_MEMBER/VIEWER).  
* Новая таблица `ProjectMember (organizationId, projectId, userId, role: PROJECT_EDITOR | PROJECT_VIEWER)` — необязательное сужение доступа до конкретных сайтов.  
* Матрица прав в коде: `src/platform/authorization/capabilities.ts`, проверяемые capability вида `catalog.write`, `project.editorial.write`, `source.run`, `snapshot.publish`, `agent.consent.record` и т.д. Тест матрицы обязателен.

**dh-01.2 — Вход.**

* Логин \+ пароль, `disableSignUp`. Флаг `ADMIN_TOTP_REQUIRED=false` по умолчанию: логика TOTP остаётся, но не требуется.  
* Rate limit на вход, блокировка учётки на 15 минут после 10 неудачных попыток подряд (значения в конфиге), аудит успешных и неуспешных входов без пароля в логах.  
* Минимальная длина пароля 12 символов.  
* Команда `pnpm admin:provision`: пароль читается из stdin, не из argv. Создаёт или сбрасывает PLATFORM\_ADMIN.  
* Флаг `CLIENT_ACCESS_ENABLED=false`: пользователи с `SystemRole=USER` не могут войти, пока флаг выключен.

**dh-01.3 — Модель тенантов.**

* `Project` расширить полями `serviceState: ACTIVE | SUSPENDED` (§75), `siteBaseUrl`, `publicUrlPolicyVersion`, `notes`.  
* Одна Organization может иметь N Project (уже есть). Убедиться, что slug уникален в пределах организации.

**dh-01.4 — RLS v2.**

* Контекст транзакции: `app.principal_kind`, `app.actor_id`, `app.organization_id`, `app.project_ids` (CSV или `*`), `app.correlation_id`.  
* Политика для `TENANT_OWNED`\-таблиц уровня проекта: `organizationId = ctx` и (`project_ids = '*'` или `projectId = ANY(...)`). Composite FK `(organizationId, projectId)` на всех проектных таблицах.  
* `PLATFORM_SHARED_CATALOG`: чтение доступно любому аутентифицированному контексту и job, запись — только `platform-admin`.  
* Новый principal `project-job (organizationId, projectId)` для ingestion и snapshot-задач. `system-job` только для платформенных задач.  
* `platform-admin` работает в явном платформенном контексте, каждое кросс-проектное действие аудируется.  
* Notification policy учитывает `visibility` (B4).  
* Удалить или закрыть guard’ом `runInDatabaseTransaction` без контекста (B3). Правило dependency-cruiser: прямой `getPrismaClient()` разрешён только в `platform/database` и `platform/auth`.  
* Обновить `verify:rls-coverage`: каждая таблица имеет RLS-класс, политику и тест.

**dh-01.5 — Исправление дефектов.**

* B5: пагинация или поиск вместо `take: 100`.  
* B6: экран выбора организации и автоматический выбор, если membership один.  
* B7: `findProjectForAction` с `organizationId`.  
* B8: `correlationId` генерируется, а не строится из `session.id`.  
* B9: ленивая инициализация `auth`.

**dh-01.6 — Hub Admin: организации и проекты.** CRUD организаций и проектов, карточка организации со списком её сайтов, переключение `serviceState`, аудит. UI пользователей и membership оставить, но скрыть клиентские роли за `CLIENT_ACCESS_ENABLED`.

### **Тесты**

Project A читает A — разрешено. Project A читает или пишет B (в той же организации) — запрещено. Организация A читает B — запрещено. Внешняя связь между проектами отклоняется FK. Кросс-проектное действие PLATFORM\_ADMIN явное и аудируется. USER при выключенном флаге не может войти. Блокировка после серии неудачных попыток работает.

### **Приёмка**

* Ни один проектный репозиторий не возвращает чужие строки в integration-тестах, включая два проекта в одной организации.  
* Вход по логину и паролю работает на продакшне после релиза.

---

## **DH-02 — Платформенные сервисы и Data Safety Gate**

**Цель:** единые безопасные S3, исходящие запросы, секреты, идентичность и контракты. Доказанные backup и restore до появления реальных данных.

### **Задачи**

**dh-02.1 — Storage (S3 Timeweb).**

* Абстракция `ObjectStorage`: put, get, head, иммутабельные ключи `sha256`, presign.  
* Префиксы: `source-artifacts/`, `snapshots/<projectId>/`, `media/`, `exports/`, `backups/`.  
* **Проверить возможности Timeweb S3** и записать ADR «Per-project snapshot isolation». Варианты по предпочтению: (а) отдельный bucket на проект с ключом доступа только к нему; (б) политика доступа к префиксу, если Timeweb её поддерживает; (в) запасной вариант — короткоживущие presigned URL, которые выдаёт Hub. Обязательный тест: учётные данные A при чтении артефакта B получают отказ.

**dh-02.2 — Safe Outbound.** HTTP-клиент: allowlist протоколов `https` (и `http` только для медиа, если профиль разрешает), блок localhost, RFC1918, link-local и IPv6-private, повторная проверка DNS и цели после редиректа, конечные таймауты, лимит байтов, проверка content-type. Все будущие запросы к фидам и медиа идут только через него (правило dependency-cruiser).

**dh-02.3 — Секреты.** Тип `SecretRef` (ссылка, а не значение). Резолвер на сервере читает значения из env, которые доставляются из SecretMaster. Редакция секретов и URL фидов в логах (pino redact) и в UI. Тест: секрет не появляется в логах.

**dh-02.4 — Идентичность и контракты.**

* Внутренние `id` \= cuid. Shared `uid` \= ULID (иммутабельный). `publicUrlId` — короткий непереиспользуемый идентификатор с таблицей резервирования.  
* Пакеты в pnpm workspace: `packages/data-contracts`, `packages/realty-contracts`. Zod-схемы, `schemaMajor/schemaMinor`, каноническая сериализация (стабильный порядок ключей). Сборка в публикуемый артефакт в SourceCraft Registry — для сайта и для build independence (§9).  
* Whitelist-паттерн DTO и тест «raw Prisma row → public DTO запрещён».

**dh-02.5 — Media intake (базовый).** Загрузка файла администратором: валидация типа и размера, `sha256`, дедупликация, S3, `MediaAsset` с метаданными прав (`rightsBasis`, `source`, `license`). Зеркалирование по URL добавляется в DH-07.

**dh-02.6 — Runtime и инфраструктура.**

* B10: healthcheck worker по `RuntimeHeartbeat` (свежесть ≤ 2 интервалов).  
* B11: `required: true` для env-файлов, fail-fast при отсутствии обязательных переменных.  
* B12: убрать `apt-get upgrade`, обновлять базовый образ сменой digest.  
* B13: закрепить `pino` точной версией.  
* B14: `scripts/db-bootstrap-roles.mjs` (идемпотентное создание ролей `ams_data_hub_web/worker/backup`, пароли через stdin или env) и шаг в `OPERATIONS.md`.  
* B15: канонический runtime — Docker Compose. Дублирующие systemd-юниты outbox удалить, на хосте оставить systemd только для backup-таймера, если он нужен.

**dh-02.7 — Data Safety Gate (E04).**

* Backup managed PostgreSQL Timeweb: проверить расписание и retention провайдера, добавить логический дамп в S3 по таймеру.  
* Retention и версионирование S3.  
* `docs/OPERATIONS.md#restore`: runbook. Restore drill на отдельную БД с записью фактического результата.  
* Механизм freeze/unfreeze мутирующих jobs. После restore jobs остаются замороженными до reconcile.  
* Reconcile после restore: `publicUrlId`\-резервирования, `publishSequence`, uid.  
* Политика хранения raw-артефактов (§48.1): последние 3 GOOD и до 30 дней, job удаления с аудитом.

### **Приёмка**

Все тесты Safe Outbound зелёные (127.0.0.1, частные сети, редирект в частную сеть, перебор размера, таймаут). Изоляция S3 между проектами доказана тестом. Restore drill выполнен, результат записан в `05_DELIVERY_STATE.md`. Health worker отражает реальное состояние.

---

## **DH-03 — Shared Catalog новостроек (Краснодар, Крым, Ростов-на-Дону)**

**Цель:** ручной AMS-каталог ЖК, с которым можно работать сразу после merge, переиспользуемый несколькими сайтами.

### **Задачи**

**dh-03.1 — Гео.** `Region`, `City`, `District` с uid, нормализованными именами, алиасами и lifecycle. Seed-миграция:

* Краснодарский край → Краснодар;  
* Республика Крым;  
* г. Севастополь (отдельный субъект);  
* Ростовская область → Ростов-на-Дону.

Районы владелец добавляет вручную через Admin.

**dh-03.2 — Застройщики и ЖК.** `Developer`, `Development` (привязан к City и District), `Building` (корпус или литер: этажность, срок сдачи, статус строительства, материал, класс). Алиасы, статусы, lifecycle, merge и relink командами с аудитом.

**dh-03.3 — Факты и история.** `FactProvenance` (источник значения, кем и когда внесено), `PriceObservation` (цена или диапазон за м² и за объект по типам квартир, дата наблюдения), `CatalogChangeSet` и `CatalogEntityVersion` (версия на каждое изменение), `SharedMediaAsset` с правами.

**dh-03.4 — Hub Admin «Каталог».**

* Списки с фильтрами по региону, городу, застройщику и статусу.  
* Формы создания и редактирования Developer, Development, Building.  
* Загрузка фото и планировок через media intake.  
* Вкладка истории изменений и источника значения.  
* Быстрый ввод: добавить корпуса пачкой в рамках ЖК.  
* Запрет: данные клиентских XML никогда автоматически не попадают в shared-каталог.

**dh-03.5 — Подписка проектов.** `ProjectCatalogSubscription` с режимами `ALL_SHARED` (по выбранным городам) и `CURATED` (явный include/exclude), аудит подписки, логика выборки для snapshot.

**dh-03.6 — Зарезервировать на будущее, без реализации:** `NEW_BUILD_UNIT` в inventory (квартиры от застройщика из XML), связь `ListingDevelopmentLink` (реализуется в DH-07). Импорт каталога из XLSX — отдельный эпик по триггеру (dry-run → diff → apply).

### **Тесты**

Один `developmentUid` подписан двумя проектами, при этом у них независимые редактура и URL. Проектный пользователь не может писать в shared-каталог. Каждое изменение создаёт версию и provenance.

### **Приёмка**

Владелец после релиза вручную заводит застройщика, ЖК, корпуса, цены и фото по трём регионам. Проект подписывается на город.

---

## **DH-04 — Project State: редактура, URL, lifecycle, контакты, агенты**

**Цель:** всё постоянное проектное состояние, которое не может храниться в сайте без БД.

### **Задачи**

**dh-04.1 — ProjectPublicContact (§32A).** Модель (`phone`, `email?`, `addressPublic?`, `messengers?`, `hours?`), форма в карточке проекта. Это единственный источник fallback-контакта агентства.

**dh-04.2 — Project Editorial (E10).** `EntityEditorial (projectId, entityType, entityUid, shortDescription, description, faq, presentationNotes)`, порядок медиа с учётом `isImageOrderChangeAllowed`. Long-form SEO-тексты ЖК в Hub не хранятся (§33). Публичный маппер.

**dh-04.3 — URL Registry и lifecycle (E11, §34–36).** `ProjectUrlEntry`, `ProjectRedirect (301)`, привязка `publicUrlId`, назначение slug, блокировка slug после публикации, история редиректов, tombstones. Факт-статусы `ACTIVE | INACTIVE | ARCHIVED | DEPARTED`, presentation-статусы `VISIBLE | ARCHIVED_VISIBLE | REDIRECTED | GONE`. Ручные операции relink и retire. Grammar URL задаётся в конфиге проекта (шаблоны путей приходят от сайта) — Hub их хранит, но не придумывает.

**dh-04.4 — Агенты: домен и ручной ввод (E22, §19–32).**

* `Agent` по модели §20: роли, `origin FEED | MANUAL`, `status ACTIVE | HIDDEN | DEPARTED`, `listingPresenceStatus`, `showOnSite`, `sortOrder`, consent-поля.  
* `AgentExternalIdentity`, `AgentMatchReview`, `AgentMergeEvent` (таблицы сейчас, логика сопоставления — в DH-07).  
* Владение полями FEED\_OWNED и MANUAL\_OWNED (§23).  
* Форма агента с загрузкой фото, команды merge, relink и split с аудитом.  
* Защита массовых операций: более 30% затронутых агентов дают `SUSPICIOUS` (§25).

**dh-04.5 — Consent batch (§28).** Выбор агентов → кто подтвердил, дата, основание, ссылка, заметка → аудируемый batch-event. Условие публикации агента: `ACTIVE && showOnSite && consentConfirmedAt`.

**dh-04.6 — Hub Admin «Проект».** Вкладки: Контакты, Агенты, Редактура, URL и редиректы, Подписка на каталог, Источники (заглушка до DH-06), Snapshot (заглушка до DH-05).

### **Тесты**

Смена slug создаёт 301\. `publicUrlId` не переиспользуется. Редактура проекта A не видна проекту B. Фид не меняет MANUAL\_OWNED-поля (тест на будущем command API). `NO_ACTIVE_LISTINGS` не создаёт редирект.

### **Приёмка**

Для проекта можно полностью заполнить контакты, агентов с согласиями, редактуру и URL-состояние.

---

## **DH-05 — Snapshot, подпись, доставка, ACK**

**Цель:** иммутабельный подписанный артефакт проекта и проверяемая доставка на сайт.

### **Задачи**

**dh-05.1 — Snapshot Composer (E12, §37–38).**

* Датасеты: `geo`, `developers`, `developments`, `buildings`, `prices`, `media`, `inventory`, `agents`, `project/contacts`, `editorial`, `urls`, `redirects`, `lifecycle`. Файлы `<kind>.<sha256>.json.gz`.  
* Manifest: `schemaMajor/Minor`, `projectId`, монотонный `publishSequence`, `generatedAt/publishedAt`, `catalogRevision`, `sourceRevisions[]`, `files[] {kind, key, sha256, bytes, count}`, `keyId`, `signature`.  
* Детерминированная сериализация, проверка ссылочной целостности.  
* Privacy-проекция и сканер запрещённых полей до подписи: нет `apartmentNumberPrivate`, raw HTML, endpoint и credential, приватных данных агентов, consent evidence.  
* Проекция публичной точности локации: детерминированное обобщение координат по uid и версии политики, без случайного jitter. Тест: координаты в snapshot N и N+1 совпадают.  
* Если для flow нужен fallback, а `ProjectPublicContact` отсутствует, сборка падает.

**dh-05.2 — Подпись (§39).** Ed25519, приватный ключ только в SecretMaster. Trust set: текущий ключ, следующий ключ и список отозванных `keyId`. Runbook плановой ротации и экстренного отзыва в `OPERATIONS.md`. Все 6 обязательных тестов §39.2.

**dh-05.3 — Delivery (E13, §40).** Загрузка в изолированное хранилище проекта, `current manifest`, webhook без данных, polling как запасной канал, `DeliveryRun` (`PENDING → NOTIFIED → DOWNLOADED → APPLIED → ACKNOWLEDGED | FAILED | STALE`), stale после 24 часов без ACK.

**dh-05.4 — ACK.** Проектный токен (хранится хэш), ротация, защита от replay и идемпотентность, проверка `projectId + publishSequence`.

**dh-05.5 — SUSPENDED (§75).** Ingestion и публикация останавливаются, чтение уже опубликованных артефактов сохраняется, last-good не отзывается. При возврате в ACTIVE следующая публикация идёт с большим `publishSequence`.

**dh-05.6 — Rollback (§42).** «Опубликовать старое содержимое как новый snapshot с большим sequence».

**dh-05.7 — Эталонный потребитель (Hub-сторона E15).** Пакет `packages/snapshot-verifier` — функция проверки, которую подключит REALTY LITE: trust set, подпись, revoked keyId, schemaMajor, sha256, bytes, Zod, ссылочная целостность, отказ от меньшего sequence. Contract-тесты в Hub на реальных собранных snapshot. Документ `docs/contracts/SNAPSHOT_V1.md` для команды сайта.

**dh-05.8 — Основа портируемости (E05).** Схема `ProjectExitBundleV1` (каркас), контракт `DATA_MODE=hub | local`, ADR о передаче контрактов (vendored-схемы).

### **Приёмка**

Snapshot собирается из каталога, контактов, агентов и редактуры, подписывается, доставляется, проверяется эталонным verifier, после чего приходит ACK. Плохой, неподписанный, отозванный или старый snapshot отклоняется. Учётные данные A не читают артефакты B.

---

## **DH-06 — Ingestion core**

**Цель:** общий production-конвейер XML/YRL для любого клиента, без кода под конкретного клиента.

### **Задачи**

**dh-06.1 — Source Registry (E17).** Модель Source по §16.3 (`endpointCredentialRef` как SecretRef, `adapterKey/Version`, `profileKey/Version`, `datasetType` включая `MIXED_REALTY`, `HTTPS_XML`, `sharingPolicy=PROJECT_ONLY`, `schedulePolicy`, `safetyPolicyId`, `enabled`, `lastAttemptAt`, `lastSuccessAt`, `lastGoodRevisionId`, `expectedNamespace`). UI: создать, редактировать, включить или выключить, запустить вручную, последний запуск, последний GOOD, проблемы.

**dh-06.2 — Registry адаптеров и профилей (E18).** Дескрипторы, capability, проверка совместимости профиля с адаптером, fail-fast на неизвестный ключ. Guard Semgrep против `projectId` и `clientSlug` в ingestion-core.

**dh-06.3 — YRL 2010 parser (E19).** Потоковый namespace-aware парсер, DTD и внешние сущности отключены, лимиты размера, количества offer и длины полей, CDATA, захват raw-атрибутов. Работа с документом целиком в памяти (DOM) запрещена. Тесты XXE, усечённого, битого и огромного фида.

**dh-06.4 — Canonical Inventory (E20, §18A).** `InventoryEntity`, `AddressValue` (`apartmentNumberPrivate` только внутри), типизированные facts по `propertyType` (Apartment, Room, House, HousePart, Land, Cottage, Townhouse, GarageBox, с резервом `NEW_BUILD_UNIT` и `COMMERCIAL`), `transactionType` отдельно от `dealKind`, sparse-семантика (`ABSENT / EXPLICIT_FALSE / EXPLICIT_ZERO / VALUE / INVALID`), нормализация единиц и UTC, санитайзер HTML по allowlist, нормализация телефонов в E.164 через проверенную библиотеку, статусы кадастрового номера.

**dh-06.5 — Конвейер импорта (§17).** Safe Intake → raw-артефакт в S3 (`rawArtifactHash`) → parse → validate → normalize (`normalizedContentHash`) → identity resolution → safety analysis → staging → `MutationPlan` → короткий apply в БД → `SourceRevision` → GOOD → триггер snapshot. Битый источник никогда не заменяет Last Good. Отказ одного Source не блокирует остальные.

**dh-06.6 — Identity и lifecycle (E21).** Ключ `(projectId, sourceId, externalOfferId)`. Grace деактивации: `INACTIVE` только при ≥2 пропущенных GOOD-прогонах **и** ≥24 часах отсутствия. Объект, вернувшийся в пределах grace, сохраняет uid, URL и статус без событий. Реактивация после деактивации.

**dh-06.7 — Safety Engine и качество данных (E24, §18B).** Уровни `INFO / WARNING / ERROR / CRITICAL`, `ImportIssue`. Bootstrap-политика: `maxDropPercent=20` с ручным подтверждением выше порога, `allowEmpty=false`, `deactivationEnabled=false` на базовом прогоне, `sourceOverdueAfterHours=24`, `ackStaleAfterHours=24`. Поля `min/maxRecordCount`, `maxGrowthPercent`, `maxInvalidPercent` калибруются после 2–3 прогонов. Состояние `SUSPICIOUS` с ручным approve или reject.

**dh-06.8 — Jobs.** Расписание источников через pg-boss, `project-job` principal, блокировка параллельного запуска одного Source, проверка `serviceState`.

### **Приёмка**

Синтетический YRL-фид на нейтральных фикстурах проходит весь конвейер до GOOD и snapshot. Пустой, усечённый фид и массовый drop не стирают данные. Ни одной строки кода под конкретного клиента.

---

## **DH-07 — Bastion: профиль, фикстуры, агенты, медиа, end-to-end**

**Цель:** реальный фид Bastion импортируется корректно, безопасно и повторяемо.

### **Задачи**

**dh-07.1 — Профиль `vladis-vt24-v1` (E26).** Алиасы категорий (квартира, комната, house, часть дома, lot, дача, таунхаус, гараж+box), типов сделки, единиц (кв. м, сотка), полей §16.5. Маппинг `deal-status` → `dealKind`. Детерминированное извлечение `Код объекта: <value>.` в `sourceObjectCode`. Паттерны подозрительного текста (только WARNING, без авто-правки через AI). Плейсхолдеры кадастровых номеров. Список `sharedOfficePhone` (OQ-04). Политика точности локации Bastion: все типы `STREET`, `DISTRICT` только явным override, `EXACT` выключен.

**dh-07.2 — Фикстуры (E27).** Санитизированный корпус `tests/fixtures/yrl/vladis-vt24/` (16 файлов по §18B.5) без реальных ПДн. URL фида только через SecretRef: в Source хранится ссылка, значение лежит в SecretMaster.

**dh-07.3 — Извлечение и сопоставление агентов (E23, §18C, §22).** `AgentSourceEvidence`. Ключ — `phoneNorm` внутри проекта. Одинаковый телефон при разных ФИО уходит в `AgentMatchReview` без авто-merge и без дублей. `sharedOfficePhone` исключён из identity. Агент без офферов получает `NO_ACTIVE_LISTINGS` и никогда `DEPARTED`. Фид не трогает MANUAL-поля и ручные назначения.

**dh-07.4 — Медиа-зеркало (E25, §18D).** Загрузка по URL через Safe Outbound, классификация, `sha256`, дедупликация, S3. Query-string не является identity. Ошибка одного изображения — WARNING. Статус медиа отделён от статуса импорта. `is-image-order-change-allowed=false` фиксирует порядок и блокирует ручную перестановку. Фото агента попадает в публикацию только после consent gate.

**dh-07.5 — ListingDevelopmentLink (§18E).** Кандидаты (адрес, алиас ЖК, ссылка из фида) со статусами `CANDIDATE | CONFIRMED | REJECTED`. Связь подтверждается только вручную. Мутации shared-каталога запрещены.

**dh-07.6 — End-to-end (E28–E29).** Организация «Бастион» → проект → Source → dry-run → прогон 1 (baseline без деактивации) → прогоны 2–3: проверка стабильности `internal-id` и калибровка SafetyPolicy → snapshot Bastion → проверка эталонным verifier → privacy-скан.

### **Приёмка**

Все категории распознаны, неизвестных материальных категорий нет. Прогоны 2–3 подтверждают стабильность ID. Snapshot не содержит номеров квартир, raw HTML и приватных данных агентов. Агенты без согласия скрыты, вместо них fallback на `project/contacts`.

---

## **DH-08 — Operations UI, алерты, Exit Bundle**

**Цель:** управлять всеми клиентами из интерфейса без SSH. Доказать, что клиент может уйти.

### **Задачи**

**dh-08.1 — Fleet dashboard (E14).** Все организации и проекты: состояние источников (последний GOOD, просрочка, SUSPICIOUS), последний snapshot, доставка и ACK, проблемы импорта, упавшие jobs.

**dh-08.2 — Действия.** Run Source, approve или reject SUSPICIOUS, Build и Publish Snapshot, rollback как новый sequence, ротация ACK-токена, просмотр аудита, freeze и unfreeze jobs.

**dh-08.3 — Алерты (E31).** Через модуль notifications и email владельцу: источник просрочен больше 24 часов, SUSPICIOUS, CRITICAL-импорт, ACK stale больше 24 часов, падение worker, неудачный backup.

**dh-08.4 — Exit Bundle (E16, Hub-сторона).** Команда экспорта `ProjectExitBundleV1` по структуре §7: публичные данные, `AgentPublicV1`, контакты, редактура, URL, редиректы, lifecycle, манифест медиа, vendored-схемы, `HANDOFF.md`, `DATA_SCHEMA.md`, `OPERATIONS.md`. Механизм переноса медиа в хранилище клиента с переписыванием URL. Отдельный защищённый экспорт consent evidence с аудитом передачи. Тест-сканер: в публичном bundle нет приватных полей.

### **Приёмка**

Текущее состояние всех проектов видно из UI. Алерты приходят. Exit Bundle собирается, проходит сканер и валидацию схемы.

---

## **DH-09 — Pilot Release Gate и go-live**

**Цель:** закрыть чек-лист E32 конституции для Hub-стороны и выпустить Bastion в продакшн.

### **Задачи**

* **dh-09.1** — Прогнать и задокументировать все блоки E32: Data, Privacy/Content, Agent, Media, Safety, Delivery isolation, Snapshot, плановая ротация ключа. Каждое доказательство со ссылкой на тест или лог записать в `05_DELIVERY_STATE.md`.  
* **dh-09.2** — Совместный прогон с сайтом (E30): Hub выключен, S3 выключен после apply — сайт рендерит. Exit Bundle \+ `DATA_MODE=local` на чистой машине. Это работа команды сайта, Hub предоставляет артефакты и verifier.  
* **dh-09.3** — Закрыть OQ-04 и OQ-05. Включить `deactivationEnabled` после калибровки.  
* **dh-09.4** — Финальная синхронизация документации и `CHANGELOG.md`, релиз по digest, live-доказательство.

### **Приёмка**

Все обязательные доказательства PASS, значит BASTION PILOT PRODUCTION READY.

---

## **DH-10 — Второй фид и мультиисточники (по триггеру)**

Аудит реального фида второго клиента (E33). Решение: переиспользовать YRL-адаптер с новым профилем или писать новый адаптер (E34). Совместимость контрактов (E35). Проект с несколькими Source — доказательство композиции (E36). Сюда же относится XML новостроек от застройщика или агентства: тот же YRL, `dealKind=PRIMARY_SALE`, связь с shared-каталогом только через ручное подтверждение.

---

## **4\. Бэклог по триггеру (вне текущего плана)**

XLSX-импорт каталога новостроек (dry-run → diff → apply). Клиентский вход в Hub (`CLIENT_ACCESS_ENABLED=true`, UI для ORG\_ADMIN и PROJECT\_EDITOR). 2FA или иная усиленная защита входа (OQ-09, пересмотр через 2–3 месяца). API- и CSV-адаптеры. Продвинутая сборка мусора медиа. Профиль FULL (Payload).

## **5\. Открытые вопросы, влияющие на план**

| ID | Вопрос | Когда закрыть |
| ----- | ----- | ----- |
| OQ-04 | Список общих офисных телефонов Bastion | до DH-09 |
| OQ-05 | Паттерны подозрительного текста после калибровки | после прогонов 2–3 (DH-07) |
| OQ-09 | 2FA для админа | через 2–3 месяца эксплуатации |
| OQ-01, 02, 08 | Сроки хранения после расторжения, лицензия frozen-каталога, лиды | до первого коммерческого договора |
| OQ-10 (новый) | Договор поручения на обработку ПДн между ИП и агентством (для агентов и данных фидов) | до DH-07 (реальные данные Bastion) |
| OQ-11 (новый) | Возможности изоляции Timeweb S3 по bucket или префиксу | в DH-02 (ADR) |

---

## **6\. Стартовая инструкция после APPROVED handoff**

На стадии `DRAFT | REVIEW | READY_FOR_OWNER_APPROVAL` этот раздел не
исполняется. Он становится инструкцией Developer только после финального
аудита exact version, явного утверждения владельцем, чистого Beads-import и
`Reconcile = CLEAN`.

1. Положить конституцию v3.1.2 в `docs/00_CONSTITUTION.md`, а этот план — в `docs/04_IMPLEMENTATION_PLAN.md`.  
2. Прочитать `AGENTS.md`, skills владельца по git-циклу SourceCraft, затем этот план.  
3. Создать ветку `epic/dh-00-canon-cleanup` и выполнить задачи dh-00.1…dh-00.7.  
4. Пройти git-цикл §0.3. Следующий эпик начинается только после merge, удаления веток и обновления `05_DELIVERY_STATE.md`.

---

## **7\. Architect intake — v0 DRAFT**

### **7.1. MASTER PLAN MAP**

**Primary goal:** превратить текущую production-owned основу AMS Data Hub в
мультиарендную Data + Operations Platform AMS: shared catalog, project data,
YRL ingestion, agents, signed immutable snapshots, delivery/ACK, operations UI
и проверяемый выход клиента без runtime-зависимости сайта от Hub.

**Non-goals:** Hub как runtime backend сайта; CMS/SEO engine/page builder;
общая клиентская PostgreSQL; Lead Hub; client-specific parser branches;
универсальный mapping DSL; Payload для REALTY LITE; production без отдельной
release-команды владельца.

**Major outcomes:**

1. Канон и текущая платформа очищены от starter-состояния без потери уникальных
   security/release contracts.
2. Organization → Project isolation, project-scoped RLS и capability model
   доказаны на PostgreSQL.
3. Shared catalog, project editorial/URL/lifecycle/contact/agent state имеют
   однозначное ownership.
4. Reusable YRL adapter + source profile строят canonical inventory без
   client-specific branches и не заменяют Last Good опасным импортом.
5. Snapshot подписан, privacy-projected, доставляется изолированно и применяется
   сайтом атомарно с last-good и ACK.
6. Operations UI и алерты позволяют работать без SSH.
7. ProjectExitBundleV1 и `DATA_MODE=local` доказывают реальный handoff.
8. Bastion pilot получает отдельный production gate; сам rollout остаётся
   отдельной owner-authorized release-фазой.

**Epics:** DH-00…DH-09 — основной implementation/pilot contour; DH-10 —
trigger-based second-feed proof и не должен автоматически входить в первый
completion boundary без подтверждённого триггера.

**Shared foundations:** current Application Platform Core 3.4, PostgreSQL 18,
Better Auth, scoped DB/RLS, command boundary, outbox + pg-boss, SourceCraft
manual gates, immutable web/worker/migrator images.

**Data/schema:** tenant/project permissions, shared catalog, project state,
source registry, canonical inventory, agents/consent, media, snapshots,
deliveries/ACK and operational evidence. Schema/auth/RLS changes are serialized
RISKY work.

**External integrations:** Timeweb Managed PostgreSQL, Timeweb S3, Secret
Master, SourceCraft Registry, Bastion YRL feed and downstream REALTY LITE
consumer. Каждый обязательный внешний контур должен получить preflight,
fallback и stop condition до approval.

**Security-sensitive areas:** PII, admin authentication, project isolation,
RLS, Safe Outbound/XXE, capability-secret feed URL, media fetch, consent,
snapshot signing/revocation, per-project storage access, ACK authentication,
backup/restore and public privacy projection.

**Infrastructure/release boundary:** implementation и pre-production evidence
разрешаются только после approval/handoff; secrets, live feed apply, registry
publish, server mutation, production database and rollout require their own
explicit gates. Production is not an ordinary Developer task.

### **7.2. Initial finding register**

Это intake findings, не финальный audit scorecard.

| ID | Severity | Scope | Finding | Recommendation | Owner decision | Status |
| --- | --- | --- | --- | --- | --- | --- |
| MP-001 | BLOCKER | §0.3 delivery | План запускает local checks и SourceCraft Gate до/при создании PR, использует `git branch -D` и связывает следующий эпик с production release. Это противоречит действующему AMS workflow: PR создаётся без checks, Gate выполняется только перед merge, cleanup использует safe `-d`, production не является условием начала следующего implementation epic. | Переписать delivery contract в Task Manager shape: implementation/verification/delivery PR_ONLY/owner merge decision; production вынести в отдельный gate. | no | OPEN |
| MP-002 | BLOCKER | DH-09 | `go-live` и release по digest находятся внутри обычной implementation chain, хотя Developer не имеет production authority. | Разделить pilot readiness evidence и отдельную owner-authorized RELEASE task/decision, не попадающую в autonomous ready-loop. | no | OPEN |
| MP-003 | MAJOR | auth/security | DRAFT утверждает `ADMIN_TOTP_REQUIRED=false` для CRITICAL-платформы с PII, signing keys и production operations, тогда как текущий Data Hub требует verified TOTP для Platform Admin. | До approval оформить owner/security decision: сохранить mandatory TOTP либо доказать компенсирующие controls и ограниченный pilot boundary. Рекомендация Architect — сохранить обязательный TOTP для production Platform Admin. | yes | NEEDS_OWNER |
| MP-004 | MAJOR | DH-00 docs | Массовое удаление действующего канона и ADR задано без обязательного mapping unique meaning → new source, docs-link guard и rollback checkpoint. | Добавить отдельный documentation mapping/normalization task через `ams-project-documentation`; удалять legacy только после доказанного переноса уникального смысла. | no | OPEN |
| MP-005 | MAJOR | dependency/autonomy | Зависимости заданы преимущественно на уровне целых эпиков; contract freeze, shared schema/config ownership, parallel-safe waves и минимальный blocking scope не описаны. | Построить task-level dependency matrix `HARD | CONTRACT | SOFT | EXTERNAL | OWNER | PRODUCTION`, выделить freeze points и independent waves. | no | OPEN |
| MP-006 | MAJOR | external prerequisites | S3 isolation, signing keys, feed access, REALTY LITE consumer, legal/consent evidence и Timeweb backup перечислены как будущие действия, но не имеют полного preflight/fallback/stop contract. | До final audit добавить External Preconditions matrix; реальные secret values не извлекать на стадии plan assembly. | partly | OPEN |
| MP-007 | MAJOR | acceptance/evidence | Несколько эпиков имеют только крупное итоговое утверждение без entry/exit, rollback/recovery, delivery mode и promise tier (`domain-model | wired | live`). | Довести каждый DH epic до исполнимого Epic Contract и разделить local evidence, SourceCraft attestation и live proof. | no | OPEN |
| MP-008 | QUESTION | source of truth | Фактические входные имена `00_CONSTITUTION.MD.md` и `AMS Data Hub Master Plan v1.md` расходятся с будущими canonical names из DH-00. | Сохранить текущие файлы как intake basis; rename/mapping выполнять только в одобренном DH-00 stream, без второй competing копии. | no | OPEN |
| MP-009 | QUESTION | scope | DH-10 помечен «по триггеру», но включён в общую карту DH-00…DH-10 без явного completion rule. | Исключить DH-10 из первого обязательного completion boundary и открывать отдельной APPROVED revision либо заранее описанным trigger task. | yes | NEEDS_OWNER |

### **7.3. Owner decisions represented by the provided basis**

Загруженный документ заявляет решения о tenant model, ролях, публичной
поверхности, manual-first shared catalog, Bastion/YRL pilot, REALTY LITE
boundary и Timeweb/SourceCraft infrastructure. На стадии `v0 DRAFT` они
считаются revision input, а не approval exact execution graph. Отдельно до
approval требуется подтвердить MP-003 и MP-009.

### **7.4. Revision history**

#### **v0 — DRAFT — 2026-10-03**

**Revision input ID:** `OWNER-2026-10-03-01`  
**Source:** owner-provided master-plan basis + constitution v3.1.2.  
**Accepted as basis:** primary goal, domain boundaries, DH epic map, Bastion
pilot target, snapshot/ingestion/portability direction.  
**Not yet accepted as executable graph:** delivery sequence, production steps,
TOTP decision, whole-epic dependencies, external prerequisites and completion
boundary for DH-10.  
**Task Manager:** read-only preflight only; `bd 1.3.0`, database absent, no
`Init`/`Import`/mutation performed.  
**Next:** assembly round with owner/external findings. Final audit starts only
after an explicit command such as «Переходим к финальной проверке».

