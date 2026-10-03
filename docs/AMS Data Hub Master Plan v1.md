# **AMS Data Hub — Implementation Master Plan**

```text
Plan ID: AMS-DATA-HUB-IMPLEMENTATION-2026-01
Version: v1
Status: APPROVED
Phase: APPROVAL_HANDOFF
Baseline repository SHA: 6246a2fa26ed8aaae629f891d6c64d07c0f8a96f
Revision input: OWNER-2026-10-03-01 + FINAL-AUDIT-2026-10-03-01
Canonical working file: docs/AMS Data Hub Master Plan v1.md
Architecture input: docs/00_CONSTITUTION.MD.md (v3.1.2 provided basis)
Approved by: owner, explicit command «План утверждён», 2026-10-03
Task Manager import: AUTHORIZED AFTER VALIDATE
Developer handoff: AUTHORIZED AFTER CLEAN RECONCILE
Production: NOT AUTHORIZED
```

> Architect guard: загруженная основа принята как `v0 DRAFT`, исправлена и
> проверена как exact `v1`.
> Раздел «Стартовая инструкция для Codex» не разрешает реализацию, пока exact
> version не прошла финальный audit, не получила статус
> `READY_FOR_OWNER_APPROVAL` и владелец явно не сказал «План утверждён».
> Exact `v1` прошла этот gate и утверждена; Beads остаётся единственным
> execution state, а production требует отдельной release-команды.

**Текущий canonical working file:** `docs/AMS Data Hub Master Plan v1.md`; target
после approved DH-00 mapping: `docs/04_IMPLEMENTATION_PLAN.md`
 **Архитектурный input:** `docs/00_CONSTITUTION.MD.md`; target после approved
DH-00 mapping: `docs/00_CONSTITUTION.md` (v3.1.2, без смысловых изменений)
 **Продакшн:** `https://data-hab.ams24.ru`  
 **Канонический git:** SourceCraft (`integrator-p/ams-data-hub`)  
 **Инфраструктура:** сервер Timeweb Cloud, managed PostgreSQL Timeweb, S3 Timeweb, секреты в Secret Master, образы в SourceCraft Registry
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

1. Перед новым независимым потоком обновить `origin/main` и создать отдельную
   ветку/worktree от exact `origin/main`; не переключать ветку в чужом dirty
   worktree.
2. Задачи эпика делать отдельными логическими checkpoint-коммитами
   `dh-XX.N: <описание>` и после каждой закрытой задачи выполнять push.
3. После организационного завершения эпика открыть один Pull Request в
   SourceCraft с `delivery_mode=PR_ONLY`. Создание PR не запускает tests,
   review, build, CI или Merge Gate; проверить только source/target/head SHA.
4. Пока PR ждёт решения владельца, Developer продолжает только независимую
   ready work из матрицы §8. Зависимая работа ждёт merge/freeze point, а не
   production release.
5. Команда владельца на вывод PR в `main` запускает review полного exact diff,
   risk-specific local proof и один manual exact-head `RISKY` SourceCraft Gate.
   Только green gate разрешает merge.
6. После merge обновить canonical `main`, записать merge SHA и evidence в
   `docs/DELIVERY_STATE.yaml`, затем удалить ветку безопасно (`git branch -d`)
   только если она действительно merged. Force delete не является default.
7. Production не входит в Developer ready-loop. По отдельной явной команде
   владельца выполняется один exact-main release по `image@sha256` с live proof
   и rollback contract.

Эпики являются границами PR, а не единицами блокировки всего графа. Внутри
эпика проверки запускаются только по необходимости реализации; формальный
proof концентрируется перед merge.

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

**Подтверждённые дефекты** (проверены по коду exact `6246a2f`, исправляются в
DH-00, DH-01 и DH-02):

| \# | Дефект | Где исправляется |
| ----- | ----- | ----- |
| B1 | Роль STAFF имеет кросс-тенантную запись (включая `Member`) без MFA | DH-01 |
| B2 | RLS изолирует только по `organizationId`, изоляции Project нет | DH-01 |
| B3 | Экспортируется `runInDatabaseTransaction` без auth-контекста — обход | DH-01 |
| B5 | `take: 100` в `listFormOptions` и `listProjectTrees` молча обрезает списки | DH-01 |
| B6 | Несколько membership без `activeOrganizationId` дают `CABINET_USER_INACTIVE` | DH-01 |
| B8 | `session.id` попадает в `correlationId` | DH-01 |
| B9 | `auth` инициализируется при импорте модуля | DH-01 |
| B10 | Healthcheck worker `process.kill(1,0)` при `init: true` всегда зелёный | DH-02 |
| B11 | `env_file required: false` — контейнер стартует без секретов | DH-02 |
| B12 | `apt-get upgrade` в runtime-слое ломает воспроизводимость образа | DH-02 |
| B13 | `pino` не закреплён точной версией | DH-02 |
| B14 | Миграция RLS требует заранее созданных ролей БД, bootstrap отсутствует | DH-02 |
| B16 | `NEXT_PUBLIC_CONTACT_*` — форма лидов, которой в Hub быть не должно | DH-00 |

**Отклонённые claims исходного аудита:** B4 уже закрыт
`visibilityWhere(audience)` и проверкой audience; B7 вызывается только из
Platform Admin boundary и сам по себе не является tenant bypass; B15 не
подтвердился — systemd управляет тем же Compose stack, а отдельный timer
запускает только retention. Эти пункты не импортируются как bugs. Узкое
defense-in-depth улучшение B7 допустимо внутри DH-01, но не является критерием
готовности.

---

## **2\. Решения владельца, зафиксированные планом**

| Тема | Решение |
| ----- | ----- |
| Репозиторий | Этот репозиторий и есть AMS Data Hub. Нейтральность и следы стартера удаляются полностью |
| Тенанты | Organization \= агентство-клиент. Project \= сайт клиента, 1…N на организацию |
| Вход | Логин + пароль, регистрации нет. Для `PLATFORM_ADMIN` в production обязательна проверенная TOTP 2FA (`ADMIN_TOTP_REQUIRED=true`) и break-glass recovery. Отключение допустимо только в local/test. Обязательны rate limit, блокировка после серии неудачных попыток и аудит входов |
| Роли сейчас | Только `PLATFORM_ADMIN`: владелец и помощник, у каждого своя учётка. Роль STAFF удаляется |
| Роли потом | Модель доступа клиентов строится сразу (организационные и проектные роли, матрица прав, RLS), но UI клиентского входа выключен флагом `CLIENT_ACCESS_ENABLED=false` |
| Каталог новостроек | Полноценный, ручной ввод через Hub Admin. Seed: Краснодарский край (Краснодар), Республика Крым, г. Севастополь, Ростовская область (Ростов-на-Дону). XML новостроек подключается позже тем же YRL-адаптером |
| Вторичка | YRL-фиды, первый — Bastion (`yrl-realty-2010` \+ `vladis-vt24-v1`) |
| Публичная часть Hub | Только страница входа (текущий дизайн сохраняется), `/politika/` и подвал с реквизитами. Hub закрыт от индексации |
| Сайт REALTY LITE | Вне scope. Hub поставляет контракты, snapshot и эталонный тестовый потребитель |
| Инфраструктура | Timeweb (сервер, PostgreSQL, S3) + Secret Master. Канонический runtime — Docker Compose с образами из SourceCraft Registry |

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
| DH-09 | Pilot Readiness Gate | E30 (Hub-сторона), E32 | да |
| DH-10 | Второй фид и мультиисточники (по триггеру) | E33–E36 | да |

Критический путь на уровне минимальных blocking tasks: DH-00 documentation
mapping → DH-01 auth/RLS contract → DH-02 safety foundations → frozen public
DTO/snapshot contracts → DH-07 real-feed proof → DH-09 readiness. DH-03,
DH-04, contract-first часть DH-05, synthetic часть DH-06 и часть DH-08
открываются волнами по матрице §8; production не является зависимостью.
DH-10 не входит в completion boundary этой версии.

---

## **DH-00 — Канон, очистка, публичная поверхность**

**Цель:** репозиторий выглядит и читается как AMS Data Hub, без следов шаблона. Публичная часть сведена к входу, политике и подвалу.

### **Задачи**

**dh-00.1 — Mapping и нормализация канона.** Сначала составить таблицу
`роль → текущий файл → целевой Source of Truth → уникальный смысл → действие`,
проверить ссылки и только после этого переносить/переименовывать. Целевая
структура сохраняет обязательный AMS Product Development Standard 2.0:

| Файл | Роль |
| ----- | ----- |
| `AGENTS.md` | короткий router для Codex: порядок чтения, инварианты, git-цикл, команды проверок |
| `README.md` | что это за продукт, как запустить локально, ссылки на docs |
| `docs/00_CONSTITUTION.md` | program-level domain/operations constitution v3.1.2; numbered canon ссылается на неё и не дублирует детали |
| `docs/01_PRD.md` | продукт, пользователи, scope V1, роли, требования и open questions |
| `docs/02_PRODUCT_STRUCTURE.md` | экраны, маршруты, flows и публичная поверхность Hub Admin |
| `docs/03_ARCHITECTURE.md` | модули, data ownership, профиль платформы, RLS-классы, async, stack, security и production contract |
| `docs/04_BACKLOG.md` | NOW/NEXT/LATER и ссылка на exact APPROVED implementation plan/Beads graph |
| `docs/05_RELEASE_CHECKLIST.md` | release readiness, exact-main release, live proof и rollback |
| `docs/04_IMPLEMENTATION_PLAN.md` | этот exact master plan после approved rename; не второй backlog |
| `docs/DELIVERY_STATE.yaml` | machine-readable epic/PR/SHA/proof pointer; без требований и acceptance |
| `docs/SECURITY.md` | доверительные границы, ПДн, секреты, подпись snapshot, вход |
| `docs/OPERATIONS.md` | деплой, релиз, rollback, backup/restore, ротации ключей, инциденты |
| `docs/ENVIRONMENT.md` | реестр переменных окружения без значений |
| `docs/DESIGN_SYSTEM.md` | единые UI-правила Admin и страницы входа |
| `docs/contracts/` | описание snapshot-контрактов и Exit Bundle |
| `docs/adr/` | только действующие ADR |
| `CHANGELOG.md` | история изменений продукта с v0.1.0 |

**dh-00.2 — Перенос и cleanup только после mapping PASS.** Сохранить и
обновить `01_PRD.md`, `02_PRODUCT_STRUCTURE.md`, `03_ARCHITECTURE.md`,
`04_BACKLOG.md`, `05_RELEASE_CHECKLIST.md`. Для `MASTER_PLAN*`, `DERIVATION`,
`HANDOVER`, legacy `PRODUCT/ARCHITECTURE`, `AUTH`, deploy/ops и двух legacy
design-system файлов сначала перенести актуальный уникальный смысл в
профильный numbered source либо доказанно самостоятельный optional extension,
обновить все ссылки и получить `pnpm docs:check` PASS. Лишь затем удалить
superseded files одним отдельным checkpoint-коммитом; rollback — revert этого
коммита. `starter.identity.json`, derivation/clean-room scripts и package
commands удаляются только после замены project-owned guards и доказательства,
что release/conformance contract не потерян.

**dh-00.3 — Ревизия ADR.** Действующие решения (профиль платформы, RLS
ADR-006, async, release по digest) сохранить под стабильными IDs либо дать
явную mapping-таблицу старый ID → новый ID. Не перенумеровывать ради косметики.
Starter-specific ADR удалять только после доказанного переноса уникального
решения и обновления ссылок.

**dh-00.4 — Зачистка кода и конфигов от следов шаблона.** Убрать упоминания `starter`, `MicroSaaS`, `copy-source`, `derived`, `neutral`, `derivation` из кода, комментариев, скриптов, `.semgrep.yml`, dependency-cruiser, тестов и package.json. Добавить guard `scripts/verify-no-template-traces.mjs` и включить его в `verify:quick`. Исключение — только `CHANGELOG.md` (запись «initial import»).

**dh-00.5 — Публичная поверхность.**

* Оставить: `/` (страница входа, текущий дизайн), `/politika/`, `not-found`, `error`.  
* Удалить: `/soglasie/`, `/cookies/`, `/terms/`, `/offline/`, `manifest.ts`, service worker, PWA-ассеты и тесты, `sitemap.ts`, лендинговые блоки, `NEXT_PUBLIC_CONTACT_*` и код формы контактов (B16).  
* `robots.ts`: `Disallow: /`. Во всех layout добавить `noindex, nofollow`.  
* Подвал: «© AMS · ИП Скрицкая Юлия Викторовна · ИНН 231295699557 · ОГРНИП 323237500365055 · integrator-p@yandex.ru · Политика обработки персональных данных».  
* `/politika/`: единая «Политика обработки персональных данных и конфиденциальности» с реквизитами оператора. Разделы: категории данных (учётные данные пользователей Hub, рабочие контакты агентов клиентов, данные из фидов клиентов), цели, правовые основания, роль Hub как обработчика по поручению агентств для данных их фидов, сроки хранения, меры защиты, хранение на серверах в РФ, cookie (только технически необходимые сессионные), права субъектов, контакт. Текст пометить как требующий юридической проверки владельцем.

**dh-00.6 — Идентичность продукта в приложении.** `appName`, метаданные, title, favicon — «AMS Data Hub». Домен `data-hab.ams24.ru` вынести в одну конфигурацию.

**dh-00.7 — Module map и guards.** Зафиксировать все будущие ownership-boundary
в Module Map `03_ARCHITECTURE.md`, но не создавать пустой production-код и
README-каркасы «на будущее». Каждый module directory появляется в первом
эпике, который даёт ему реальный vertical slice. Общие dependency-cruiser
правила добавить сейчас; `notifications` сохранить как канал алертов.

### **Приёмка**

* `pnpm verify:quick` зелёный. Guard «нет следов шаблона» зелёный.  
* Mapping полного текущего docs tree зафиксирован; каждый удалённый файл имеет
  target и proof переноса уникального смысла; в docs ровно один authoritative
  документ на каждую область.
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

* Логин + пароль, `disableSignUp`. `ADMIN_TOTP_REQUIRED=true` обязателен в
  production для `PLATFORM_ADMIN`; local/test могут явно выключать его.
  Provisioning включает настройку TOTP, проверку второго фактора, offline
  recovery material и отключение bootstrap path.
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
* Сохранить уже действующий `visibilityWhere(audience)` и добавить regression
  test, что platform staff не читает `PLATFORM_ADMIN_ONLY`; B4 не является
  открытым defect.
* Удалить или закрыть guard’ом `runInDatabaseTransaction` без контекста (B3). Правило dependency-cruiser: прямой `getPrismaClient()` разрешён только в `platform/database` и `platform/auth`.  
* Обновить `verify:rls-coverage`: каждая таблица имеет RLS-класс, политику и тест.

**dh-01.5 — Исправление дефектов.**

* B5: пагинация или поиск вместо `take: 100`.  
* B6: экран выбора организации и автоматический выбор, если membership один.  
* Defense-in-depth: при появлении tenant/project command искать Project по
  server-owned `organizationId + projectId`; текущий Platform Admin-only path
  не классифицируется как B7 defect.
* B8: `correlationId` генерируется, а не строится из `session.id`.  
* B9: ленивая инициализация `auth`.

**dh-01.6 — Hub Admin: организации и проекты.** CRUD организаций и проектов, карточка организации со списком её сайтов, переключение `serviceState`, аудит. UI пользователей и membership оставить, но скрыть клиентские роли за `CLIENT_ACCESS_ENABLED`.

### **Тесты**

Project A читает A — разрешено. Project A читает или пишет B (в той же организации) — запрещено. Организация A читает B — запрещено. Внешняя связь между проектами отклоняется FK. Кросс-проектное действие PLATFORM\_ADMIN явное и аудируется. USER при выключенном флаге не может войти. Блокировка после серии неудачных попыток работает.

### **Приёмка**

* Ни один проектный репозиторий не возвращает чужие строки в integration-тестах, включая два проекта в одной организации.  
* В pre-production E2E подтверждены login + mandatory TOTP, lockout,
  recovery и запрет client login; production live proof относится только к
  отдельному release gate после DH-09.

---

## **DH-02 — Платформенные сервисы и Data Safety Gate**

**Цель:** единые безопасные S3, исходящие запросы, секреты, идентичность и контракты. Доказанные backup и restore до появления реальных данных.

### **Задачи**

**dh-02.1 — Storage (S3 Timeweb).**

* Абстракция `ObjectStorage`: put, get, head, иммутабельные ключи `sha256`, presign.  
* Префиксы: `source-artifacts/`, `snapshots/<projectId>/`, `media/`, `exports/`, `backups/`.  
* **Проверить возможности Timeweb S3** и записать ADR «Per-project snapshot isolation». Варианты по предпочтению: (а) отдельный bucket на проект с ключом доступа только к нему; (б) политика доступа к префиксу, если Timeweb её поддерживает; (в) запасной вариант — короткоживущие presigned URL, которые выдаёт Hub. Обязательный тест: учётные данные A при чтении артефакта B получают отказ.

**dh-02.2 — Safe Outbound.** HTTP-клиент: allowlist протоколов `https` (и `http` только для медиа, если профиль разрешает), блок localhost, RFC1918, link-local и IPv6-private, повторная проверка DNS и цели после редиректа, конечные таймауты, лимит байтов, проверка content-type. Все будущие запросы к фидам и медиа идут только через него (правило dependency-cruiser).

**dh-02.3 — Секреты.** Тип `SecretRef` (ссылка, а не значение). Резолвер на сервере читает значения из env, которые доставляются из Secret Master. Редакция секретов и URL фидов в логах (pino redact) и в UI. Тест: секрет не появляется в логах.

**dh-02.4 — Идентичность и контракты.**

* Внутренние `id` \= cuid. Shared `uid` \= ULID (иммутабельный). `publicUrlId` — короткий непереиспользуемый идентификатор с таблицей резервирования.  
* Project-owned workspace-пакеты `packages/data-contracts` и
  `packages/realty-contracts`: Zod-схемы, `schemaMajor/schemaMinor`,
  каноническая сериализация. Downstream transfer по умолчанию — pinned
  vendored schema/release artifact. Общий runtime package или package registry
  допускается только после ADR и доказанного repeated need; OCI Registry
  остаётся хранилищем release images, а не подразумеваемым npm registry.
* Whitelist-паттерн DTO и тест «raw Prisma row → public DTO запрещён».

**dh-02.5 — Media intake (базовый).** Загрузка файла администратором: валидация типа и размера, `sha256`, дедупликация, S3, `MediaAsset` с метаданными прав (`rightsBasis`, `source`, `license`). Зеркалирование по URL добавляется в DH-07.

**dh-02.6 — Runtime и инфраструктура.**

* B10: healthcheck worker по `RuntimeHeartbeat` (свежесть ≤ 2 интервалов).  
* B11: `required: true` для env-файлов, fail-fast при отсутствии обязательных переменных.  
* B12: убрать `apt-get upgrade`, обновлять базовый образ сменой digest.  
* B13: закрепить `pino` точной версией.  
* B14: `scripts/db-bootstrap-roles.mjs` (идемпотентное создание ролей `ams_data_hub_web/worker/backup`, пароли через stdin или env) и шаг в `OPERATIONS.md`.  
* Канонический runtime — Docker Compose, а systemd unit остаётся host-level
  lifecycle wrapper того же Compose stack. Retention timer запускает только
  одноразовый `outbox-retention`; удалять его как «дублирующий worker» нельзя
  без отдельного operational proof. Добавить guard, исключающий второй
  постоянный outbox worker.

**dh-02.7 — Data Safety Gate (E04).**

* Backup managed PostgreSQL Timeweb: проверить расписание и retention провайдера, добавить логический дамп в S3 по таймеру.  
* Retention и версионирование S3.  
* `docs/OPERATIONS.md#restore`: runbook. Restore drill на отдельную БД с записью фактического результата.  
* Механизм freeze/unfreeze мутирующих jobs. После restore jobs остаются замороженными до reconcile.  
* Reconcile после restore: `publicUrlId`\-резервирования, `publishSequence`, uid.  
* Политика хранения raw-артефактов (§48.1): последние 3 GOOD и до 30 дней, job удаления с аудитом.

### **Приёмка**

Все тесты Safe Outbound зелёные (127.0.0.1, частные сети, редирект в частную сеть, перебор размера, таймаут). Изоляция S3 между проектами доказана тестом. Restore drill выполнен, результат записан в `DELIVERY_STATE.yaml`. Health worker отражает реальное состояние.

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

На synthetic/pre-production данных оператор создаёт застройщика, ЖК, корпуса,
цены и фото по трём регионам, проект подписывается на город, а второй проект
переиспользует тот же shared entity без утечки project state. Реальный ручной
ввод после release — операционная работа, не acceptance эпика.

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

**dh-05.2 — Подпись (§39).** Ed25519, приватный ключ только в Secret Master. Trust set: текущий ключ, следующий ключ и список отозванных `keyId`. Runbook плановой ротации и экстренного отзыва в `OPERATIONS.md`. Все 6 обязательных тестов §39.2.

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

**dh-07.2 — Фикстуры (E27).** Санитизированный корпус `tests/fixtures/yrl/vladis-vt24/` (16 файлов по §18B.5) без реальных ПДн. URL фида только через SecretRef: в Source хранится ссылка, значение лежит в Secret Master.

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

## **DH-09 — Pilot Readiness Gate**

**Цель:** закрыть чек-лист E32 конституции для Hub-стороны и доказать
готовность Bastion pilot к отдельному owner-authorized production release.

### **Задачи**

* **dh-09.1** — Прогнать и задокументировать все блоки E32: Data, Privacy/Content, Agent, Media, Safety, Delivery isolation, Snapshot, плановая ротация ключа. Каждое доказательство со ссылкой на тест или лог записать в `DELIVERY_STATE.yaml` как pointer на Beads ledger/артефакт, не копируя требования.
* **dh-09.2** — Совместный прогон с сайтом (E30): Hub выключен, S3 выключен после apply — сайт рендерит. Exit Bundle \+ `DATA_MODE=local` на чистой машине. Это работа команды сайта, Hub предоставляет артефакты и verifier.  
* **dh-09.3** — Закрыть OQ-04 и OQ-05. Включить `deactivationEnabled` после калибровки.  
* **dh-09.4** — Финальная синхронизация документации и `CHANGELOG.md`, freeze
  exact candidate main SHA, release manifest и rollback rehearsal. Никакого
  deploy, server mutation, production migration или live release внутри
  implementation graph.

### **Приёмка**

Все обязательные pre-production доказательства PASS, exact candidate SHA и
image contract зафиксированы: `BASTION PILOT READY FOR OWNER RELEASE DECISION`.
Production выполняется только отдельной командой владельца через
`ams-production-deploy` и не меняет status implementation tasks.

---

## **DH-10 — Второй фид и мультиисточники (по триггеру)**

Аудит реального фида второго клиента (E33). Решение: переиспользовать YRL-адаптер с новым профилем или писать новый адаптер (E34). Совместимость контрактов (E35). Проект с несколькими Source — доказательство композиции (E36). Сюда же относится XML новостроек от застройщика или агентства: тот же YRL, `dealKind=PRIMARY_SALE`, связь с shared-каталогом только через ручное подтверждение.

---

## **4\. Бэклог по триггеру (вне текущего плана)**

XLSX-импорт каталога новостроек (dry-run → diff → apply). Клиентский вход в Hub (`CLIENT_ACCESS_ENABLED=true`, UI для ORG\_ADMIN и PROJECT\_EDITOR). Дополнительный phishing-resistant second factor при доказанной необходимости; mandatory TOTP Platform Admin уже входит в DH-01. API- и CSV-адаптеры. Продвинутая сборка мусора медиа. Профиль FULL (Payload).

## **5\. Открытые вопросы, влияющие на план**

| ID | Вопрос | Когда закрыть |
| ----- | ----- | ----- |
| OQ-04 | Список общих офисных телефонов Bastion | до DH-09 |
| OQ-05 | Паттерны подозрительного текста после калибровки | после прогонов 2–3 (DH-07) |
| OQ-09 | Second factor для Platform Admin | DECIDED: mandatory TOTP в production; более сильный factor — revisit через 2–3 месяца |
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
4. Пройти git-цикл §0.3. После PR продолжить независимую ready work по §8;
   зависимая задача ждёт merge/freeze point. Production не является условием
   следующего эпика.

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
| MP-001 | BLOCKER | §0.3 delivery | Исходный цикл смешивал PR, Gate, force cleanup и production. | §0.3 переписан в `PR_ONLY`; Gate только перед merge, cleanup safe, production отдельно. | no | RESOLVED |
| MP-002 | BLOCKER | DH-09 | Go-live был обычной implementation task. | DH-09 стал Pilot Readiness Gate; release вынесен в owner-authorized production phase. | no | RESOLVED |
| MP-003 | MAJOR | auth/security | `ADMIN_TOTP_REQUIRED=false` ослаблял CRITICAL/PII Platform Admin и противоречил Core 3.4. | Входной пункт REJECTED как небезопасный; production TOTP + break-glass обязательны, false разрешён только local/test. | no | RESOLVED |
| MP-004 | MAJOR | DH-00 docs | Удаление канона не имело mapping и rollback. | Добавлены Standard 2.0 mapping, preservation, link guard и отдельный reversible cleanup checkpoint. | no | RESOLVED |
| MP-005 | MAJOR | dependency/autonomy | Whole-epic dependencies скрывали freeze points и ready waves. | Добавлены task-scoped dependency matrix, shared-contract sequencing и waves §8. | no | RESOLVED |
| MP-006 | MAJOR | external prerequisites | Critical внешние контуры не имели preflight/fallback/stop. | Добавлена external preconditions matrix §10; реальные credentials/secrets не читаются Architect. | no | RESOLVED |
| MP-007 | MAJOR | acceptance/evidence | Epic contracts не разделяли entry/exit, rollback, tier и delivery. | Добавлена Epic Contract matrix §9 и promise/evidence contract §11. | no | RESOLVED |
| MP-008 | QUESTION | source of truth | Intake filenames отличаются от будущих canonical paths. | Текущие файлы остаются единственным intake basis; rename выполняется как `git mv` только в approved DH-00 после mapping. | no | RESOLVED |
| MP-009 | QUESTION | scope | DH-10 trigger-based, но выглядел частью первого completion boundary. | DH-10 явно исключён из v1 graph и требует отдельного owner trigger/approved revision. | no | RESOLVED |

### **7.3. Owner decisions represented by the provided basis**

Загруженный документ заявляет решения о tenant model, ролях, публичной
поверхности, manual-first shared catalog, Bastion/YRL pilot, REALTY LITE
boundary и Timeweb/SourceCraft infrastructure. На стадии `v0 DRAFT` они
считаются revision input, а не approval exact execution graph. Отдельно до
MP-003 разрешён более строгим обязательным security contract; MP-009 разрешён
исключением DH-10 из completion boundary. Before-approval owner decisions: 0.

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

#### **v1 — READY_FOR_OWNER_APPROVAL — 2026-10-03**

**Revision input ID:** `FINAL-AUDIT-2026-10-03-01`
**Source:** explicit owner transition to final check; exact v0 at
`c83ca7e4ca5d56e85cc601dcad0e4bc5c84e6252`; code baseline
`6246a2fa26ed8aaae629f891d6c64d07c0f8a96f`.
**Accepted:** product/domain outcomes, Data Hub production identity, Bastion
pilot, manual shared catalog, signed snapshot/delivery/exit direction.
**Rejected:** pre-PR gate, force branch deletion, production inside Developer
loop, disabled production TOTP, deletion-before-mapping, empty future module
scaffolds, B4/B7/B15 as confirmed bugs and DH-10 in first completion boundary.
**Added:** task-scoped dependency matrix, epic contracts, external preconditions,
owner decision register, promise/evidence tiers and four-pass audit scorecard.
**Task Manager:** import remains forbidden until exact owner phrase
«План утверждён» or «План утвержден».

#### **v1 — APPROVED — 2026-10-03**

**Approver:** owner.
**Approval command:** `План утверждён`.
**Approved scope:** exact `v1` с Plan ID
`AMS-DATA-HUB-IMPLEMENTATION-2026-01`; DH-00…DH-09, `PR_ONLY`, без DH-10 и
без production.
**Authorized next step:** build immutable inventory schema v2, then
`Validate → Init → Import → Reconcile`; Developer goal starts only on `CLEAN`.
**Not authorized:** release, production deployment, new secret creation,
real PII/feed execution or merge to `main` without its separate owner command.

---

## **8. Dependency matrix и ready waves**

`HARD` блокирует только указанную task, не целый epic. `CONTRACT` открывается
после freeze перечисленного DTO/API/schema contract. `SOFT` задаёт удобный
порядок. `EXTERNAL`, `OWNER` и `PRODUCTION` используют §10 и §12. Один plan
имеет одного writing worker; waves дают альтернативную ready work, а не
разрешают двум агентам писать в один worktree.

| Scope | Depends on | Type / blocking scope | Entry / freeze point | Parallel-safe / fallback | Wave |
| --- | --- | --- | --- | --- | --- |
| dh-00.1 mapping | approved v1 import | OWNER, pre-execution | exact plan + current docs inventory | read-only code audit | W0 |
| dh-00.2…7 cleanup | dh-00.1 mapping PASS | HARD, cleanup tasks only | unique meaning mapped, rollback commit defined | no deletion; continue mapping/guards | W0 |
| dh-01 auth/RLS contract | v1 role/tenant decisions | CONTRACT | role matrix, RLS classes and migration sequence frozen | dh-02.1…3 design | W1 |
| dh-01 migrations/runtime | auth/RLS contract | HARD, schema/apply tasks | expand/migrate/contract plan + test DB guard | non-schema DH-02 work | W1 |
| dh-02 safety foundations | v1 platform profile | CONTRACT | storage/outbound/SecretRef interfaces frozen | dh-01 tests/docs | W1 |
| dh-02 runtime cleanup | dh-00 config cleanup merge | SOFT, shared config files | no overlapping package/Docker edits | storage/outbound implementation | W1 |
| dh-03 catalog schema/write | dh-01 RLS class freeze | HARD, tenant/RLS migrations only | shared-catalog RLS and ownership contract frozen | dh-04 domain contracts | W2 |
| dh-03 media/UI | dh-02 media intake contract | CONTRACT | MediaAsset port frozen | catalog domain/data work | W2 |
| dh-04 project state | dh-01 project-scope RLS freeze | HARD, project-owned tables only | composite FK/capability contract frozen | dh-03 shared catalog | W2 |
| dh-05 manifest/verifier contract | dh-02 DTO/canonical serialization freeze | CONTRACT | SnapshotV1 + signing input frozen | dh-03/dh-04 implementation | W2 |
| dh-05 composer integration | dh-03 + dh-04 public DTO freeze | CONTRACT, dataset mappers only | catalog/project projections stable | verifier/signing/storage work | W3 |
| dh-05 delivery isolation | dh-02 storage proof | HARD, delivery tasks only | per-project isolation path passes | composer/verifier | W3 |
| dh-06 parser/safety | dh-02 Safe Outbound + SecretRef contracts | CONTRACT | interfaces frozen; synthetic fixtures available | dh-05 composer work | W3 |
| dh-06 apply/snapshot trigger | dh-01 RLS + dh-05 manifest contract | HARD, apply/publish integration only | project-job and SnapshotV1 frozen | parser/profile/tests | W3 |
| dh-07 synthetic Bastion profile | dh-06 adapter/profile contract | CONTRACT | YRL adapter API frozen | dh-08 operations contract | W4 |
| dh-07 real-feed E2E | dh-04 agents + dh-05 verifier + dh-06 GOOD pipeline | HARD + EXTERNAL, real-data task only | legal/feed/SecretRef preflight PASS | sanitized fixture work remains ready | W4 |
| dh-08 dashboard/alerts | dh-05/06 operations DTO freeze | CONTRACT | observable state/events frozen | dh-07 synthetic tasks | W4 |
| dh-08 Exit Bundle | dh-04 public state + dh-05 schemas | HARD, bundle task only | vendored schemas and privacy projection frozen | dashboard/alerts | W4 |
| dh-09 readiness | dh-02…08 required evidence | HARD, readiness only | all required ledgers and candidate SHA present | none; natural owner release gate | W5 |
| production release | dh-09 PASS + explicit owner command | PRODUCTION | clean canonical main, green exact-head gate, immutable digests, backup/rollback proof | no fallback to unverified rollout | OUTSIDE GRAPH |
| DH-10 | separate trigger and approved plan revision | OWNER | real second source exists | not required for v1 completion | NOT IMPORTED |

**DAG:** cycles = 0. Shared schema/auth/config changes have one owner and merge
sequence. Contract-first tasks open W2/W3 before full upstream epic completion.
If one external task blocks, Developer records/releases it and chooses another
ready task; no task may bypass its specific HARD dependency.

---

## **9. Epic Contract matrix**

Для всех implementation epics source of truth = Constitution v3.1.2 + relevant
numbered canon + this exact plan. Delivery mode = `PR_ONLY`; merge/release не
подразумеваются approval плана.

| Epic | Observable outcome / entry | Exit, acceptance and verification | Tier | Rollback / stop |
| --- | --- | --- | --- | --- |
| DH-00 | Exact approved v1; docs/code inventory available | mapping PASS; required 2.0 canon preserved; no template traces; public route/browser proof; `docs:check`, quick proof and targeted E2E | wired | revert cleanup checkpoint; stop on unmapped unique meaning or broken links |
| DH-01 | role/RLS contract frozen; isolated test PostgreSQL proven | migrations reviewed; tenant/project isolation integration matrix; login+TOTP+lockout+recovery E2E; no session id in logs | wired | expand/migrate/contract or forward-fix; stop on reset, unknown DB target or weaker auth |
| DH-02 | platform ports frozen; provider capabilities may be unknown but §10 applies | Safe Outbound security tests; secret-redaction proof; S3 isolation proof or selected fallback ADR; restore drill; real worker readiness | wired | disable new adapters/jobs; restore known config; stop on secret exposure or unproven isolation |
| DH-03 | RLS/media contracts frozen | two-project shared entity proof, provenance/version tests, Admin CRUD browser proof, no project write to shared catalog | wired | reversible additive migrations/feature disable; stop on catalog/project ownership ambiguity |
| DH-04 | project-scope RLS and public ID policy frozen | project isolation, slug/redirect/tombstone, consent/publication and manual-owned field tests; Admin flow proof | wired | feature disable + forward-fix; stop on PII policy or public ID reuse failure |
| DH-05 | SnapshotV1, storage and public DTO contracts frozen | deterministic build; privacy scan; six signing cases; isolated delivery; verifier and ACK/replay tests; rollback-as-new-sequence | wired | keep last-good; revoke key/token; stop on missing contact, bad signature, lower sequence or cross-project read |
| DH-06 | Safe Outbound/SecretRef/adapter contracts frozen | synthetic namespace-aware streaming YRL reaches GOOD/snapshot; XXE/limits/idempotency/drop/grace tests; one source failure isolated | wired | keep Last Good; disable source/deactivation; stop on unknown adapter, unsafe target or SUSPICIOUS without approval |
| DH-07 | synthetic profile may start after adapter freeze; real path also needs §10 PASS | sanitized corpus green; three stable runs; agent/media/privacy rules; reference verifier PASS; real feed evidence only after legal/access gates | live, bounded to feed/pre-production surface | freeze source and keep Last Good; stop real data on missing legal, consent or credential gate |
| DH-08 | operations event/DTO contracts frozen | fleet UI/browser proof; audited actions; alert delivery test; Exit Bundle validates on clean consumer and privacy scan | wired | disable action/email adapter; export remains immutable; stop on unaudited destructive action or private data leak |
| DH-09 | DH-02…08 required ledgers available | E32 matrix complete, candidate SHA/digests/rollback rehearsal recorded, joint consumer test classified; no production mutation | readiness evidence | return failing evidence to owning epic; stop at owner release gate |

Large tasks inherit: goal, scope in/out, exact dependencies, measurable
acceptance, required checks, allowed actions and stop conditions. Beads import
must preserve stable IDs `dh-XX.N`; small tasks may reference the epic contract
instead of copying it.

---

## **10. External Preconditions matrix**

| ID / prerequisite | Deadline | Preflight | Fallback / safe work | Stop condition |
| --- | --- | --- | --- | --- |
| EXT-01 Timeweb S3 isolation | before dh-02 isolation exit | prove bucket/prefix policy with A→B denial using non-production credentials | separate bucket per project or Hub-issued short-lived presigned URL | no real project artifact until isolation proof PASS |
| EXT-02 Managed PostgreSQL backup/restore | before dh-02 Data Safety exit | provider schedule/retention + isolated restore target + connection budget | encrypted logical dump to isolated S3 and non-production restore drill | no real PII/import and no production migration without proven recovery |
| EXT-03 Secret Master refs and signing key | before real dh-05/dh-07 | exact project/env/path and least-privilege runtime reference verified without printing values | ephemeral test keys and sanitized fixtures only | no live feed, real signature or deploy; Developer cannot create a new secret silently |
| EXT-04 SourceCraft OCI Registry | before owner release | pull/push identity and immutable digest proof | local/pre-production image only | production release blocked; implementation continues |
| EXT-05 Bastion YRL access | before dh-07 real-feed task | credential reference, endpoint allowlist, expected namespace and owner authorization | sanitized fixture corpus | no network fetch or real-data apply |
| EXT-06 REALTY LITE consumer | before joint dh-09 proof | pinned SnapshotV1/verifier compatibility and isolated test endpoint | Hub reference consumer proves contract | joint apply/ACK remains NOT VERIFIED; Hub work continues |
| EXT-07 PII legal/consent basis | before real Bastion data | owner/legal confirmation of processing role, retention and consent evidence contract | synthetic/anonymized data | no real agent/feed PII ingestion, publication or protected export |
| EXT-08 email alert channel | before dh-08 email acceptance | provider identity, secret ref, recipient and redaction proof | in-app notifications + recorded failed-delivery state | email claim not accepted; dashboard work continues |
| EXT-09 Bastion office phones/pattern calibration | before dh-07 final real run | OQ-04 list and OQ-05 evidence from runs 2–3 | treat uncertain matches/text as WARNING and hide from auto-publication | no auto-merge/auto-correction or final pilot readiness |

Architect and plan audit do not connect to servers, fetch secrets or create
infrastructure. Each external task is claimable only after its preflight; a
failed preflight becomes an explicit blocker dependency, not an implicit
workaround.

---

## **11. Promise, evidence и delivery contract**

1. `domain-model` = unit/property tests + typecheck + relevant static guards.
2. `wired` = domain proof + реальный route/action/job/worker/CLI/repository path
   and relevant PostgreSQL/browser/integration evidence.
3. `live` = only the named real non-production or production surface. Local
   tests, created files, successful build and a started workflow are not live
   proof.
4. Task evidence is recorded as `EXECUTION_LEDGER_V1` in Beads: changed files,
   exact checks/results, deviations, commit/push and PR/head SHA. It is not a
   second project task store.
5. PR evidence proves only PR identity. Merge evidence for this CRITICAL
   project requires review + one green exact-head `RISKY` SourceCraft Gate.
6. Production evidence exists only after explicit owner release: clean exact
   main SHA, immutable image digests, migration/backup proof, rollout,
   `/api/health`, `/api/ready`, worker/queue, changed critical flow and rollback
   marker.

---

## **12. Owner Decision Register**

| ID | Decision | Recommendation / result | Deadline | Status |
| --- | --- | --- | --- | --- |
| OD-01 | Repository becomes product-owned AMS Data Hub | keep SourceCraft primary and GitHub one-way public mirror | before approval | DECIDED |
| OD-02 | Platform Admin second factor | mandatory TOTP in production; false only local/test; retain break-glass | before approval | DECIDED by higher-priority security contract |
| OD-03 | DH-10 completion boundary | exclude from v1; separate trigger and approved revision | before approval | DECIDED |
| OD-04 | Merge mode | all v1 epics `PR_ONLY`; owner command required to review/gate/merge | before approval | DECIDED |
| OD-05 | Production release | never part of Developer graph; explicit owner release command | before approval | DECIDED |
| OD-06 | OQ-01/02/08 commercial/legal terms | resolve before first commercial contract | later | OPEN, does not block safe implementation |
| OD-07 | OQ-04/05 Bastion calibration | resolve before real dh-07 completion | later | OPEN with EXT-09 stop condition |
| OD-08 | OQ-10 legal processing basis | resolve before any real PII task | later | OPEN with EXT-07 stop condition |
| OD-09 | OQ-11 storage isolation method | choose from proven options during dh-02 ADR | later | OPEN with EXT-01 fallback/stop |

Before-approval owner decisions open: **0**.

---

## **13. Final Architect Audit — exact v1**

### **13.1. Pass 1 — Logic / Completeness**

All primary outcomes map to DH-00…DH-09. DH-10 and other triggered backlog are
outside the first completion boundary. Production, commercial-contract and
real-data gates no longer masquerade as ordinary implementation tasks.
Result: `PASS`, blockers 0, major 0.

### **13.2. Pass 2 — Architecture / Data / Security**

Application Platform Core 3.4 profile remains
`multi-tenant / outbox-plus-queue / pii / own-saas / platform-admin enabled`.
Mandatory production TOTP, project RLS, transaction-bound repositories,
Last Good, isolated storage, SecretRef, signing/revocation, privacy projection,
backup/restore and PII stops are explicit. Code audit rejected stale B4/B7/B15
claims and retained confirmed B1–B3, B5–B6, B8–B14 and B16.
Result: `PASS`, blockers 0, major 0.

### **13.3. Pass 3 — Dependencies / Autonomy**

Cycles: 0. HARD dependencies are task-scoped. Shared schema/auth/config have
single-owner freeze points. Independent W1–W4 work survives local external
blockers, while PR_ONLY merge gates remain explicit natural owner stops.
Critical path: W0 → auth/RLS+safety contracts → frozen snapshot/ingestion
contracts → real-feed proof → pilot readiness.
Result: `PASS`, cycles 0, single hidden blocking points 0.

### **13.4. Pass 4 — Executability / Evidence / Delivery**

DH-00…DH-09 have observable outcomes, entry/exit, acceptance, verification,
rollback/stop, promise tier and delivery mode. Local, merge attestation and
production live evidence are separated. No production action is importable as
Developer work.
Result: `PASS`, ambiguous critical definitions of done 0.

### **13.5. Audit scorecard**

```text
Logic/completeness: blockers=0; major=0
Architecture/data/security: blockers=0; major=0
Dependency/autonomy: cycles=0; HARD=task-scoped; independent waves=W1-W4
Executability/evidence: epics with acceptance=10/10; verification=10/10
Owner decisions before approval open=0
Unknown critical prerequisites=0 (all routed through §10)
Production actions in implementation graph=0
```

### **13.6. NIGHT RUN READINESS**

```text
Independent ready waves: W1-W4 after their contract freeze points
Critical path: W0 → auth/RLS+safety → contracts → Bastion proof → readiness
Single blocking points: owner merge gates; real-data/legal/feed prerequisites
Safe work if one task blocks: synthetic fixtures, contracts, UI, verifier,
  parser, catalog/project modules and evidence tasks allowed by §8
Expected natural stops: PR_ONLY merge command; real PII/feed access;
  production release authorization
Result: READY_WITH_LIMITS
```

Limits are unavoidable and safe: the exact plan intentionally cannot
authorize its own merge, new secrets, real PII ingestion or production. They
do not prevent approval/import; they become explicit Beads blocker/decision
nodes, and Developer continues other ready work.

### **13.7. Readiness verdict**

Exact `v1` satisfies the Architect gate and is
`READY_FOR_OWNER_APPROVAL`. This is not approval. Beads `Init/Import`, graph
mutation and Developer goal remain forbidden until the owner says exactly
«План утверждён» or «План утвержден».
