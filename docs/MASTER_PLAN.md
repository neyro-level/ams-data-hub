# AMS MicroSaaS Starter Hardening Master Plan

`docs/04_BACKLOG.md` — канонический product-facing backlog. Этот документ
остаётся единственным Task Manager execution graph для программы hardening и не
дублирует продуктовые требования.

```text
Plan ID: AMS-MICROSAAS-HARDENING-2026-01
Version: v4
Status: APPROVED
Phase: EXECUTION
Repository: integrator-p/ams-microsaas-starter
Baseline SHA: 698bf8074280f250b56f6e0fd72909dc71f68702
Delivery mode: PR_ONLY unless an APPROVED revision explicitly changes it
Production: prohibited by this plan
```

## 1. Primary Goal

Превратить `ams-microsaas-starter` в нейтральную и воспроизводимую основу
MicroSaaS-продуктов AMS, сопоставимую с AMS IMPULSE по силе platform foundation,
security boundaries, data isolation, verification и release contract, но без
переноса SEO/Research/provider-домена, production identity и исторической
сложности AMS IMPULSE.

Starter остаётся copy-source с `DELIVERY_PROFILE = EXPERIMENT` и не получает
собственный production. Производный repository обязан выбрать собственный
`DELIVERY_PROFILE`, secrets, database topology, domain и release target.

## 2. Target Platform Profile

Целевой strong MicroSaaS profile:

```text
Platform contract = AMS Application Platform Core 3.4 — Solo Minimal
TENANCY = multi-tenant
ASYNC = outbox-plus-queue
DATA = pii
DELIVERY = own-saas
PLATFORM_ADMIN = enabled
DATABASE = product-defined PostgreSQL 18
DELIVERY_PROFILE(starter repository) = EXPERIMENT
DELIVERY_PROFILE(derived product) = explicit COMMERCIAL | CRITICAL before release
```

`outbox-plus-queue` означает готовый и доказанный foundation, а не обязанность
каждого производного продукта создавать фоновые события. Неиспользуемая очередь
не должна требовать production worker до появления реального async contract.

## 3. Non-Goals

- перенос SEO Monitor, Research, XMLRiver, Yandex, Topvisor или других
  продуктовых модулей AMS IMPULSE;
- копирование 53 исторических migrations AMS IMPULSE;
- создание универсального CRUD/meta-framework;
- обязательные MCP/OAuth, payments, billing или email provider;
- автоматический production deploy starter repository;
- production secrets, домен, VPS, Managed PostgreSQL или Secret Master project;
- смена SourceCraft primary или создание GitHub CI;
- скрытая major-upgrade зависимостей;
- генератор с большим количеством интерактивных режимов до доказательства, что
  простой copy-source contract недостаточен.

## 4. Baseline Evidence And Gaps

Baseline подтверждён на exact SHA, указанном в заголовке:

- `pnpm verify:quick` — LOCAL PASS;
- unit tests — 10/10 LOCAL PASS;
- Next.js production build — LOCAL PASS;
- Dependency Cruiser — 159 modules / 332 dependencies, violations = 0;
- schema — 15 neutral models и одна initial migration;
- product/provider vertical отсутствует;
- Git working tree перед revision был clean.

Известные пробелы baseline:

1. PostgreSQL RLS и transaction-local authorization context отсутствуют.
2. `test:integration` не запускает реальную PostgreSQL suite.
3. Tenant isolation, missing-context deny и cross-tenant writes не доказаны.
4. Tenant principal не имеет явного выбора организации при нескольких
   memberships; используется первая запись.
5. Platform Admin MFA/recovery и database-backed auth rate limit отсутствуют.
6. Project registry writes не полностью проходят общий command/transaction
   contract; audit может быть неатомарен с mutation.
7. Outbox/lease/idempotency/concurrency не имеют PostgreSQL evidence.
8. Runtime image содержит лишний build/source surface и не разделяет runtime и
   migrator так строго, как AMS IMPULSE.
9. Repository не содержит versioned `.sourcecraft/branches.yaml`.
10. Project canon использует legacy document names вместо AMS Product
    Development Standard 2.0.
11. Derivation contract основан в основном на ручном поиске `ams-start` и TODO.
12. Проект уже использует TypeScript 6.0.3, тогда как Core Standard 3.4 держит
    baseline на 5.9.x; исключение или controlled downgrade не оформлены.

## 5. Target Guarantee Matrix

| Guarantee | Required target state | Required evidence |
| --- | --- | --- |
| Neutrality | В starter нет product/provider runtime | static guard + clean-room derivation smoke |
| Version contract | Exact stack и осознанные project exceptions зафиксированы | official-doc evidence + version matrix |
| Identity | Better Auth владеет password/session; signup off | unit + PostgreSQL integration + auth E2E |
| Provisioning | Первый доступ не зависит от постоянного слабого пароля | one-time setup/revocation tests |
| Platform Admin | TOTP обязателен; recovery контролируем | integration + recovery tests + E2E |
| Tenant selection | organization context выбирается явно на сервере | multi-membership tests + route/action proof |
| Tenant isolation | default deny, RLS, composite ownership и wired runtime context для каждого защищённого пути | PostgreSQL 18 isolation suite + web/worker wired proof |
| Commands | authorize + DB context + mutation + audit/outbox атомарны | command/integration tests |
| Async | outbox, lease, retry, dead-letter, heartbeat и retention доказаны | concurrency/integration tests |
| PII | secrets/PII не попадают в browser/log/error/cache | static + unit + E2E |
| PII lifecycle | inventory/access/retention/export/deletion/backup описаны | policy matrix + executable guards where applicable |
| Architecture | module public APIs и dependency direction enforceable | Dependency Cruiser + static guards |
| CI | push/PR = zero paid CI; merge = one exact-head gate | config contract tests |
| Artifact | reviewed SHA превращается в immutable minimal image | image/runtime inspection |
| Release template | backup/restore/rollback/live proof существуют как template | rehearsal-only local evidence |
| Derivation | новый продукт создаётся без legacy identity и hidden coupling | clean copy smoke + checklist |

## 6. Delivery Waves

| Wave | Scope | Parallelism |
| --- | --- | --- |
| W0 Contract and proof foundation | E00, E00A, E01 | E00 contract first; E00A and E01 then parallel-safe |
| W1 Security and data | E02–E03 | contracts first; E03 включает wired adoption существующих web/admin/health/worker DB-путей; schema/auth serialized |
| W2 Commands and reliability | E04–E05 | начинается только после безопасно слитого E03; E04 не является обходом runtime wiring |
| W3 Cross-contract proof | E06 | consolidate suites after each feature epic adds its own tests |
| W4 Gates, runtime and UX safety | E07–E09 | parallel after their contract prerequisites |
| W5 Derivation and closure | E10–E11 | E10 before final conformance |

Schema/migrations, auth, RLS, shared runtime and release tooling are never
implemented concurrently in the same worktree.

## 7. Epic Contracts

### E00 — Canon And Profile Alignment

**Outcome:** один актуальный project canon описывает starter, derived product
contract и границы между `EXPERIMENT` repository и будущим
`COMMERCIAL | CRITICAL` продуктом.

**Scope in:**

- нормализовать документы к AMS Product Development Standard 2.0;
- сохранить только уникальный актуальный смысл legacy docs;
- зафиксировать profile, Source of Truth, environment ownership, delivery и
  production prohibition;
- создать traceability от guarantees к epics и executable evidence;
- зафиксировать exact version matrix и официальный compatibility evidence для
  Next.js, Prisma, Better Auth, PostgreSQL, pg-boss и текущего TypeScript 6;
- оформить ADR для осознанных усилений baseline: multi-tenancy, RLS и
  `outbox-plus-queue`;
- определить PII lifecycle matrix: inventory, access, masking, retention,
  export, deletion, audit и backup retention.

**Scope out:** production runbook конкретного продукта, secrets, server access.

**Dependencies:** none.

**Acceptance:**

- есть `docs/README.md`, `01_PRD.md`, `02_PRODUCT_STRUCTURE.md`,
  `03_ARCHITECTURE.md`, `04_BACKLOG.md`, `05_RELEASE_CHECKLIST.md`;
- `AGENTS.md` остаётся коротким router;
- нет двух authoritative документов для одной области;
- все legacy документы либо mapped, либо явно сохранены как justified extension,
  либо архивированы после переноса уникального смысла;
- TypeScript 6 либо оформлен как проверенное project exception, либо вынесен в
  отдельный controlled downgrade; скрытого major-line drift нет;
- PII lifecycle и причины применения RLS/outbox не остаются неявными.

**Verification:** docs link check, source-of-truth guard, review mapping.

**Delivery:** PR_ONLY, STANDARD docs proof.

**Stop conditions:** противоречивый platform profile или потеря уникального
security/release contract.

---

### E00A — Safe PostgreSQL Test Foundation

**Outcome:** настоящий PostgreSQL 18 test harness существует до auth/tenancy/
async implementation и безопасно переиспользуется всеми последующими эпиками.

**Scope in:**

- native-first test database preflight;
- `APP_ENV=test`, `_test` database marker, separate test credential и
  production-host denylist;
- isolated migrate/seed/cleanup lifecycle;
- base runtime-compatible test identities;
- empty-database smoke и повторный deterministic run;
- замена placeholder `test:integration` на реальный fail-closed harness.

**Scope out:** feature assertions для auth, RLS, commands и async; Docker как
обязательный local default.

**Dependencies:** E00 environment/version contract freeze.

**Acceptance:** unsafe/unknown target отклоняется до destructive action;
`pnpm test:integration` обращается к реальному PostgreSQL 18 и дважды проходит
на чистой test database.

**Verification:** target-guard negative tests, clean migrate/seed/cleanup,
repeated PostgreSQL run.

**Delivery:** PR_ONLY, RISKY.

**Rollback:** удалить только доказанную disposable `_test` database и вернуть
test harness commit; никакой production target не затрагивается.

**Stop conditions:** неизвестный target, отсутствие `_test` marker, production
host/credential или запрос destructive reset вне доказанной test database.

---

### E01 — Neutral Foundation And Derivation Contract

**Outcome:** platform identity и обязательные project-specific substitutions
заданы единым нейтральным contract, а не распределёнными строковыми заменами.

**Scope in:**

- inventory всех `ams-start`, domain, legal, image, DB-role, queue, service,
  systemd и registry placeholders;
- project identity contract для app name, slug, origin, health service ID,
  database application names и artifact names;
- fail-closed verification незаменённых TODO/placeholder;
- copy-source derivation checklist и credential-free repository map.

**Scope out:** сложный scaffolding generator и template distribution service.

**Dependencies:** E00 contract freeze.

**Acceptance:** новый copy может получить другую identity без ручного поиска по
десяткам несвязанных файлов; starter verification обнаруживает незаменённые
критичные placeholders.

**Verification:** static identity tests и clean-room derivation smoke.

**Delivery:** PR_ONLY, STANDARD unless scripts alter release behavior.

---

### E02 — Identity And Platform Admin Hardening

**Outcome:** Better Auth и AMS authorization создают свежий server-owned
principal; Platform Admin защищён MFA, recovery и устойчивым rate limiting.

**Scope in:**

- official-version verification Better Auth 1.7.x и schema transition contract;
- explicit organization selection для multi-membership user;
- session invalidation на disable/grant revoke/security change;
- one-time hashed setup token, запрет business access до завершения setup и
  revocation остальных setup tokens после успеха;
- обязательный TOTP для Platform Admin authority;
- one-time hashed recovery material и operator flows;
- PostgreSQL-backed auth rate limits;
- explicit trusted origins/cookie/CSRF/trusted proxy/IP и safe auth error
  contract;
- совместимая Better Auth schema baseline.

**Scope out:** public signup, social login, arbitrary role editor, MCP OAuth.

**Dependencies:** E00A test foundation и E00 profile/version contract; E03
зависит только от frozen principal/context contract, а не от полного завершения
UI E02.

**Acceptance:** disabled/revoked user теряет доступ со следующего запроса;
Platform Admin authority невозможен без verified TOTP; multi-membership user не
получает implicit first-membership tenant; первый business access невозможен до
завершения one-time setup; постоянный eight-character bootstrap password больше
не является основным provisioning contract.

**Verification:** unit, PostgreSQL integration, auth E2E, safe-log inspection.

**Delivery:** PR_ONLY, RISKY.

**Rollback:** additive schema first; auth transition имеет forward-fix и
operator recovery path.

**Stop conditions:** несовместимая Better Auth schema transition или отсутствие
детерминированного admin recovery.

---

### E03 — PostgreSQL Tenant Isolation And Runtime Identities

**Outcome:** tenant-owned records защищены application scope, composite
constraints и PostgreSQL RLS; отсутствие DB context закрывает доступ, а каждый
существующий web/admin/health/worker путь к RLS-protected данным передаёт
явный transaction-local principal.

**Scope in:**

- server-owned database authorization context;
- transaction-local `principal_kind`, user/job/api и organization context;
- wired adoption этого context во всех существующих reachable runtime paths,
  которые читают или пишут RLS-protected tables;
- least-privilege `system-job` principal для worker operations; он не может
  имитировать user/platform-staff и не получает identity или tenant-membership
  data без отдельного policy contract;
- RLS helpers and policies для всех tenant-owned tables;
- composite tenant ownership constraints;
- отдельные `web`, `worker`, `migrator`, `backup`, test identities;
- non-owner `NOBYPASSRLS` runtime roles;
- executable RLS coverage inventory;
- official Prisma/PostgreSQL evidence и ADR rationale для RLS как
  defense-in-depth при `multi-tenant + pii`;
- regenerate single baseline migration, пока starter не имеет production.

**Scope out:** production credentials и live database migration.

**Dependencies:** E00A test foundation и E02 principal/context contract freeze.

**Required runtime adoption map (v4):**

| Runtime surface | Current implementation anchors | Required transaction-local principal and invariant |
| --- | --- | --- |
| Identity resolution | `platform/authorization/principal-factories.ts` | `identity` only for the signed-in user's membership lookup; it may not become a generic bypass for `Member`. |
| Platform identity administration | `identity-access/infrastructure/prisma-identity-admin-repository.ts` | `platform-admin`; every organization/member/audit read or write is in one authorized transaction. |
| Project registry and project tree | `project-registry/server.ts` | `platform-admin` for registry; calling user principal for project tree; audit remains in the same scoped transaction as its mutation. |
| Notifications and reads | `notifications/infrastructure/prisma-notification-repository.ts` | calling platform principal; RLS for `NotificationRead` binds the row user to the transaction actor, not only to a visible notification. |
| Admin dashboard and operations list | `platform-admin/infrastructure/dashboard-summary.ts`, `platform-operations/infrastructure/platform-admin-runtime.ts` | `platform-admin`; aggregate/list reads remain available with no unscoped Prisma access. |
| Readiness and queue health | `platform-operations/infrastructure/readiness-runtime.ts`, `PrismaReliabilityRepository.getOutboxHealth` | explicit non-human operations-read scope with only the required aggregate/read capability. |
| Worker claim/complete/fail and retention | `prisma-reliability-repository.ts`, `runtime-heartbeat.ts`, `retention-runtime.ts`, worker composition | separate `system-job`; global claim is allowed only for `OutboxEvent`/`JobRun`/operational rows required by the worker, never for user, session, organization, member or project data. |

The map is exhaustive for all current direct accesses to E03 RLS-protected
models. A new protected-model callsite is either added to this map and tested or
is rejected by the protected-model access guard.

**Acceptance:** missing context и cross-tenant reads/writes запрещены БД; runtime
roles не могут обходить RLS; все tenant tables попадают в coverage inventory;
ни один reachable runtime path не обращается к RLS-protected model вне
authorized transaction; platform-admin, readiness/health и worker outbox,
heartbeat, retention flows сохраняют доказанно нужную функциональность под
своими least-privilege principals; `NotificationRead` cannot be read or changed
for a different actor merely because the parent notification is visible.

**Verification:** PostgreSQL 18 integration suite, migration/ACL tests,
`verify:rls-coverage`, destructive-target guard, static protected-model access
guard и wired identity-admin/project/notification/admin/health/worker
integration proof под runtime roles; negative RLS proof for worker access to
identity and tenant-membership data and for cross-user notification reads.

**Delivery:** PR_ONLY, RISKY.

**Rollback:** до production starter migration может быть пересобрана; после
derivation applied migrations immutable.

**Stop conditions:** неизвестный DB target, owner/superuser runtime identity,
непокрытая tenant table или reachable unscoped access к RLS-protected model.

---

### E04 — Command, Repository And Atomic Mutation Contract

**Outcome:** каждая business mutation проходит единый transaction-bound путь, а
audit/idempotency/outbox атомарны с изменением состояния.

**Scope in:**

- `defineCommand` устанавливает DB authorization context;
- project-registry переносится на domain/application/ports/infrastructure;
- writes не используют global Prisma вне composition root;
- audit и outbox создаются в той же transaction;
- error envelope и stale/version policy унифицированы;
- запрет внешнего HTTP/storage/email внутри transaction механически проверяется.

**Scope out:** продуктовые commands и generic CRUD engine.

**Dependencies:** E03 безопасно слит с wired runtime context contract; одного
только helper API недостаточно.

**Acceptance:** нет mutation path, который пишет business state и audit двумя
независимыми transactions; cross-module consumers используют public entrypoints.

**Verification:** architecture checks, command unit tests, transaction
integration tests, failure rollback proof.

**Delivery:** PR_ONLY, RISKY.

---

### E05 — Async, Outbox And Worker Reliability

**Outcome:** neutral async foundation гарантирует atomic enqueue, idempotent
delivery, bounded retry, lease ownership, heartbeat, retention и dead-letter
visibility без product-specific topic.

**Scope in:**

- outbox state machine and topic registry contract;
- pg-boss schema migration ownership;
- long-lived worker lifecycle and graceful shutdown;
- lease/takeover/retry/dead-letter policy;
- runtime heartbeat and readiness;
- retention with evidence;
- safe consumer example limited to platform smoke, not fake business module.

**Scope out:** paid provider retry policy, schedules without product need.

**Dependencies:** E04 atomic command contract; E03 worker DB identity.

**Acceptance:** competing workers cannot complete the same lease; duplicate
idempotency key with changed payload fails; retry exhaustion produces one safe
dead-letter notification; shutdown does not abandon acknowledged work silently.

**Verification:** PostgreSQL concurrency tests, worker lifecycle tests,
readiness tests and retention proof.

**Delivery:** PR_ONLY, RISKY.

---

### E06 — Cross-Contract PostgreSQL Security Evidence

**Outcome:** единый PostgreSQL 18 evidence pass доказывает auth, tenant, RLS,
command и reliability guarantees поверх foundation из E00A.

**Scope in:**

- проверить coverage suites, добавленные E02–E05: principal, membership,
  tenant ownership, composite constraints, RLS, command rollback, audit,
  outbox/idempotency/concurrency;
- закрыть cross-contract gaps и flaky/order dependencies;
- доказать полный run из empty database и повторный run;
- сформировать machine-readable evidence summary для downstream gates.

**Scope out:** новый test runner, Docker как обязательный local default и
повторная реализация feature behavior.

**Dependencies:** E00A; каждая feature suite принадлежит E02–E05, а финальная
consolidation зависит от их verified implementation.

**Acceptance:** `pnpm test:integration` доказывает все строки target guarantee
matrix, относящиеся к auth/data/command/async, и не зависит от порядка suites.

**Verification:** clean PostgreSQL 18 run from empty database and repeated run.

**Delivery:** PR_ONLY, RISKY.

---

### E07 — Risk-Based SourceCraft Quality Gates

**Outcome:** starter поставляет dormant, но проверяемый zero-CI template:
push/PR ничего не запускают, derived COMMERCIAL/CRITICAL project получает один
manual exact-head STANDARD или RISKY gate.

**Scope in:**

- `.sourcecraft/branches.yaml` default-branch protection;
- exact-head verification;
- scoped unit/integration inputs;
- risk classifier as attention hint;
- `verify:quick`, `verify:risky`, `verify:daily`, `verify:release` без ложных
  placeholder checks;
- config contract tests for triggers and SHA chain;
- обязательный secret scan; dependency и image scan включаются только в тот
  профиль, где соответствующий artifact реально строится.

**Scope out:** paid run в EXPERIMENT starter, automatic PR/push CI.

**Dependencies:** E06 command/evidence surface; gate использует стабильные
script names из package contract и не зависит от завершения E08.

**Acceptance:** starter itself remains `CI NOT RUN (EXPERIMENT)`; derived
project can activate one exact-head gate without redesigning the workflow.

**Verification:** YAML/config tests, local exact-head negative/positive tests;
no paid SourceCraft run for starter.

**Delivery:** PR_ONLY, RISKY because CI policy changes.

---

### E08 — Hardened Runtime, Artifact And Release Template

**Outcome:** reviewed SHA produces minimal immutable runtime/migrator artifacts
with separated identities, deterministic rollback metadata and reusable
backup/restore/live-proof templates.

**Scope in:**

- separate build, runtime-deps, runtime and migrator stages;
- production image omits dev tooling and unnecessary source;
- non-root/read-only constraints and bounded writable paths;
- distinct web/worker/migrator/backup env contracts;
- image digest and previous rollback digest;
- Compose/Nginx/systemd templates without real target;
- logical backup/restore smoke and Managed PostgreSQL provider-proof interface;
- connection-budget template для web/worker/pg-boss/migrator/maintenance;
- container vulnerability inspection без registry publish;
- route/access/cache-aware live proof skeleton.

**Scope out:** actual registry publish, server mutation, DNS or production.

**Dependencies:** E00 environment/release contract; E03 DB identities; E05 worker
entrypoints. Can run parallel with late E06 work.

**Acceptance:** image inspection finds no dev-only package manager/tooling in
final runtime; migrator has only migration capability; artifact records exact
SHA/digest; rollback input is explicit.

**Verification:** local image build/inspection, Compose config, migrator probe,
rehearsal-only restore/live-proof tests.

**Delivery:** PR_ONLY, RISKY.

**Stop conditions:** registry/server/production credential required or local
Docker unavailable for artifact-specific proof.

---

### E09 — UI, PWA, Error And Observability Safety

**Outcome:** neutral public/private surfaces remain accessible and responsive,
while private, auth, PII and operational responses cannot enter caches or
unsafe public error bodies.

**Scope in:**

- application error boundaries, not-found and loading states;
- safe error envelope and correlation propagation;
- PWA static-only allowlist and old-cache cleanup;
- route-aware security/cache headers;
- structured log redaction contract;
- responsive proof at 375/768/1280/1440;
- legal/public-contact fail-closed placeholder policy.

**Scope out:** product-specific visual identity and commercial copy.

**Dependencies:** E01 identity contract; safe to implement parallel with E05–E08
outside shared config freeze points.

**Acceptance:** private/API/auth routes are never service-worker cached; public
errors contain no raw exception/SQL/provider text; TODO legal state blocks
production readiness but not local starter preview.

**Verification:** unit/static tests, Playwright cache/logout/offline flows,
responsive screenshots and header assertions.

**Delivery:** PR_ONLY, STANDARD unless security headers/runtime config change.

---

### E10 — Clean-Room Product Derivation Proof

**Outcome:** из starter создаётся новый repository snapshot с другой identity,
чистой migration baseline и работающими checks без остаточных `ams-start` или
AMS IMPULSE contracts.

**Scope in:**

- documented copy procedure;
- rename/substitution inventory;
- optional modules decision checklist;
- sample product identity without fake business domain;
- verification of Git/source identity, env registry, migration ownership,
  branch policy and delivery profile transition;
- cleanup/validation without committing machine-specific paths.

**Scope out:** публикация template service и production derived product.

**Dependencies:** E01, E06, E07, E08, E09.

**Acceptance:** fresh copy installs, generates Prisma, passes quick/unit/build,
has no forbidden identities and clearly stops before production hardening.

**Verification:** disposable-directory derivation smoke and file/content scan.

**Delivery:** PR_ONLY, RISKY if automation mutates repository identity.

---

### E11 — Final Conformance And Handover Contract

**Outcome:** exact starter SHA имеет guarantee-to-proof matrix, известные
exceptions и однозначный путь создания, hardening и release производного
продукта.

**Scope in:**

- final platform conformance review;
- current exceptions and deferred optional capabilities;
- verify command matrix and expected evidence;
- derived-project handover checklist;
- remove completed items from active backlog and reconcile docs/runtime.

**Scope out:** production release и автоматический import этого plan до owner
approval.

**Dependencies:** E00, E00A, E01–E10.

**Acceptance:** каждый обещанный guarantee имеет executable evidence или явно
ограниченный status; docs, code, schema, CI и runtime рассказывают одну историю.

**Verification:** full local daily/release-equivalent proof на final main,
clean-room derivation repeat, documentation link/source-of-truth check.

**Delivery:** PR_ONLY, RISKY final proof classification.

## 8. Audited Dependency And Execution Model

### 8.1 Dependency Matrix

| Epic | Depends on | Type | Minimum blocking scope | Parallel-safe with | Wave |
| --- | --- | --- | --- | --- | --- |
| E00 | — | — | — | — | W0 |
| E00A | E00 | CONTRACT | environment/version contract | E01 after E00 contract freeze | W0 |
| E01 | E00 | CONTRACT | identity/docs contract | E00A | W0 |
| E02 | E00, E00A | CONTRACT/HARD | auth contract; verification needs real DB harness | E01 | W1 |
| E03 | E02, E00A | CONTRACT/HARD | principal freeze; implementation after auth schema merge; RLS activation only with wired existing runtime paths | E02 non-schema UI/docs only | W1 |
| E04 | E03 | CONTRACT/HARD | command contract starts only after E03 wired runtime context is safely merged; E04 owns new command mutation wiring, not a repair of E03 runtime activation | E09 | W2 |
| E05 | E04, E03 | CONTRACT/HARD | topic contract after command freeze; atomic wiring after implementations | E09 | W2 |
| E06 | E00A, E02–E05 | HARD | consolidation only after feature evidence exists | E09 | W3 |
| E07 | E06 | HARD | only real non-placeholder commands enter gates | E08, E09 | W4 |
| E08 | E03, E05 | CONTRACT/HARD | runtime contract after role/worker freeze; image proof after merge | E07, E09 | W4 |
| E09 | E01 | CONTRACT | identity/route placeholder contract | E04–E08 outside shared config freezes | W4 |
| E10 | E01, E06–E09 | HARD | derivation uses stable merged evidence/runtime surface | — | W5 |
| E11 | E00, E00A, E01–E10 | HARD | exact completed platform snapshot | — | W5 |

Audited cycles: `0`.

Critical path: `E00 → E00A → E02 → E03 → E04 → E05 → E06 → E07 → E10 → E11`.
E01/E09 и E08 образуют независимые боковые ветви и сходятся в E10.

### 8.2 Import-Time Task Shape

Каждый epic импортируется не одной монолитной карточкой, а одинаковой цепочкой:

```text
<EPIC>.C  contract/research freeze
<EPIC>.I  implementation
<EPIC>.V  acceptance + exact-head evidence
<EPIC>.D  commit + push + отдельный PR в canonical main
<EPIC>.M  needs-owner merge gate
```

- `.C` может зависеть от upstream `CONTRACT` и открывает только работу против
  frozen interface, не против неслитого кода.
- `.I` зависит от upstream `.M`, если использует изменённый code/schema/shared
  config; зависимость нельзя заменить предположением о содержимом открытого PR.
- `.V` закрывается только evidence, указанным в Epic Contract.
- `.D` проверяет source branch, target `main` и exact head SHA; merge не запускает.
- `.M` имеет label `needs-owner`, не входит в Developer ready-loop и закрывается
  только после отдельной команды владельца на review/gate/merge.

Общие entry conditions: declared dependencies closed, зарегистрированный clean
worktree от актуального `origin/main`, доказанный repository identity и отсутствие
незавершённого overlapping owner merge gate.

Общие exit conditions: acceptance выполнен, evidence сохранён в
`EXECUTION_LEDGER_V1`, один exact commit pushed, epic PR создан, production не
затронут. Rollback до merge — закрыть/откатить только branch; после merge — новый
forward-fix PR, а не rewrite history.

### 8.3 Source Of Truth By Epic

| Epic | Primary Source of Truth |
| --- | --- |
| E00 | project `AGENTS.md`, docs map, Core Standard 3.4 |
| E00A | `.env.example`, package scripts, Prisma config/migrations, test helpers |
| E01 | PRD/Product Structure/Architecture, environment and identity config |
| E02 | Architecture auth/security sections, Better Auth schema/runtime |
| E03 | Architecture data/security sections, Prisma schema/migration, DB SQL |
| E04 | Architecture module/command rules, module public APIs and repositories |
| E05 | Architecture async contract, outbox/job schema and worker entrypoint |
| E06 | target guarantee matrix, integration suites and evidence summary |
| E07 | delivery profile, `.sourcecraft/*`, package verification scripts |
| E08 | Architecture delivery contract, Docker/Compose/ops/release checklist |
| E09 | Product Structure, Design System, routes, PWA/security config |
| E10 | derivation checklist, repository identity contract and clean-room fixture |
| E11 | full guarantee-to-proof matrix and exact final repository state |

### 8.4 External Preconditions

| Prerequisite | Preflight | Fallback | Stop condition |
| --- | --- | --- | --- |
| SourceCraft push/PR access | credential-safe remote/API check before first `.D` | keep verified local commit and continue only independent non-delivery work | no credential or remote identity mismatch blocks delivery, never changes provider |
| Native PostgreSQL 18 | `ams-local-postgres` discovery before E00A.I | native install/setup route approved by that contract | unknown/production target blocks DB work; E01/E09 contract work may continue |
| Official version docs/network | verify exact installed versions before each version-sensitive `.C` | reuse only dated official evidence already committed to research | incompatible or unverifiable API blocks affected implementation |
| Playwright Chromium | project install/status preflight before auth/UI E2E | unit/static/integration work continues | affected `.V` cannot close without required E2E |
| Local Docker engine | read-only status before E08.I | docs/config work and all non-artifact epics continue | E08.V cannot close without image/runtime inspection; WSL is not fallback |

No production server, domain, registry publish, production database or product
Secret Master project is an implementation prerequisite for this plan.

### 8.5 Shared-File And Contract Ownership

| Shared surface | Owner sequence | Parallel rule |
| --- | --- | --- |
| project docs map / `AGENTS.md` | E00 then later epic-specific updates | no competing canon rewrite |
| Prisma schema / initial migration | E02 auth schema → merge → E03 RLS/roles | never concurrent or stacked against unmerged schema |
| DB/command composition root | E03 runtime/context adoption → E04 command mutation → E05 async composition | downstream implementation waits for upstream safe merge |
| package verification scripts | E00A → E06 → E07 | stable command names; implementation changes serialized |
| Docker/release scripts | E08 owns implementation; E07 consumes public commands | no CI-owned duplicate build path |
| global route/cache/error config | E09 owns; E07/E08 only consume documented contract | overlapping edit pauses until prior merge |

### 8.6 Night Run Readiness

```text
v3 execution graph is frozen after discovery FINDING-2026-09-24-01 / ams-4tq.
E03 cannot be merged until its wired runtime-context scope is audited and
approved in v4; E04 must not be used as a post-merge repair.
Independent ready waves resume only after exact v4 approval and graph import.
Critical path: E00 → E00A → E02 → E03 → E04 → E05 → E06 → E07 → E10 → E11.
Single blocking points: explicit owner merge gates on the critical path.
Hard dependencies: only code/schema/evidence consumers listed in 8.1/8.2.
External prerequisites: all have preflight, fallback and local stop condition.
Owner decisions remaining before approval: 0.
Production-only stops: registry/server/DNS/live DB/deploy remain prohibited.
Safe work if one epic blocks: take another ready contract/UI/runtime branch;
  if none exists, stop with the exact owner/external blocker.
Task Manager revision migration: canonical helper `Upgrade` now performs a
  fail-closed preflight, preserves historical ledger notes, updates stable-ID
  plan metadata and planned dependencies, selectively reopens changed work and
  proves `Reconcile = CLEAN`; PR #77 passed exact-head `skill-risky`.
Result: READY_FOR_OWNER_APPROVAL; graph mutation still waits for exact v4
  owner approval.
```

Ограничение неизбежно: владелец выбрал `PR_ONLY` и запретил automatic merge.
Поэтому зависимый код не может безопасно строиться поверх неслитого PR. Снятие
этого ограничения потребовало бы изменить D-03 либо использовать stacked PR,
что противоречит canonical target `main` и не рекомендуется.

## 9. Owner Decision Register

### D-01 — Async Baseline

**Question:** оставить `outbox-plus-queue` обязательной частью strong MicroSaaS
foundation или снизить default до `pg-boss`, сохранив outbox как recipe?

**Recommendation:** оставить `outbox-plus-queue` в этом strong starter, потому
что цель владельца — уровень AMS IMPULSE. Производный продукт вправе не запускать
worker до появления async flow, но не должен удалять foundation без отдельного
решения.

**Decision:** оставить `outbox-plus-queue` обязательной частью strong starter.
Производный продукт может не запускать worker до появления async flow, но
foundation сохраняется по умолчанию.

**Deadline:** before APPROVAL.

**Status:** DECIDED (`OWNER-2026-09-24-02`).

### D-02 — Derivation Mechanism

**Question:** v1 остаётся контролируемым copy-source или сразу создаётся
интерактивный generator?

**Recommendation:** copy-source + fail-closed derivation smoke. Generator
рассматривать после двух реальных производных продуктов и накопления повторяемых
вариантов.

**Decision:** v1 остаётся контролируемой copy-source моделью без generator.
Generator рассматривается только после evidence минимум двух реальных
производных продуктов.

**Deadline:** before E10.

**Status:** DECIDED (`OWNER-2026-09-24-02`).

### D-03 — Delivery Policy For Implementation

**Question:** будущий APPROVED graph должен завершать каждый epic только PR или
самостоятельно merge после exact-head gate?

**Recommendation:** `PR_ONLY` для первого hardening program; merge выполнять
отдельной командой после просмотра нескольких foundational PR.

**Decision:** отдельный PR на каждый epic; автоматический merge запрещён.
Delivery policy программы — `PR_ONLY`.

**Deadline:** before APPROVAL.

**Status:** DECIDED (`OWNER-2026-09-24-02`).

### D-04 — Safe RLS Landing Sequence

**Question:** как устранить discovered P0 разрыв, при котором E03 включает
`FORCE RLS` раньше, чем существующие dashboard, readiness/health и worker paths
передают transaction-local principal?

**Recommendation:** расширить E03 до полного wired adoption существующих
runtime paths и отдельного least-privilege `system-job` scope. Это сохраняет
`PR_ONLY`, один PR на epic и исключает broken `main` между E03 и E04.

**Rejected by architecture:** слить текущий E03 и исправить доступ позднее в
E04/E05; ослабить RLS/default-deny; stacked PR как обход D-03.

**Decision:** владелец принял recommended E03 scope: полный wired adoption
существующих runtime paths и отдельный least-privilege `system-job` входят в
E03 до merge. E04 сохраняет ownership только новых command/mutation paths.

**Deadline:** before v4 APPROVAL.

**Status:** DECIDED (`OWNER-2026-09-24-03`, `FINDING-2026-09-24-01`,
`ams-4tq`).

### D-05 — Task Manager Plan Revision Upgrade

**Question:** как безопасно перенести уже исполненный v3 graph на v4 без
потери ledger, подмены Plan ID или destructive replacement локального
`.beads` store?

**Recommendation:** отдельным global-skill stream расширить canonical
`ams-task-manager-beads` helper versioned upgrade path: сохранить evidence
неизменённых задач, после полного preflight идемпотентно обновить
metadata/dependencies exact v4,
переоткрыть изменённые E03 implementation/verification/delivery tasks,
сохранить dynamic blocker history и завершить `Reconcile = CLEAN`. Добавить
self-test перехода `APPROVED vN → APPROVED vN+1` с partially completed graph.

**Rejected by architecture:** удалить или пересоздать `.beads`; выдать v4
новый Plan ID; продолжить Developer по v3 после source drift; вручную
переписать managed nodes вне проверяемого helper.

**Decision:** владелец разрешил отдельное обновление глобального
`ams-task-manager-beads`. Изменение влито как SourceCraft PR #77, exact-head
`skill-risky` прошёл для `4a18949c46aab01055813f848945e06ef32570b1`, итоговый
global `main` — `c0848e946448005d8dacbe7e252a9f1bc66af181`; GitHub mirror
сверен по тому же SHA.

**Deadline:** before v4 APPROVAL.

**Status:** DECIDED (`OWNER-2026-09-25-01`, `AUDIT-2026-09-25-02`,
SourceCraft PR #77).

## 10. Final Audit Records

Sections 10.1–10.4 preserve the exact v3 audit that authorized the original
execution graph. Section 10.5 records the separate v4 audit after D-04.

### 10.1 Master Plan Map

```text
Primary goal: strong neutral copy-source MicroSaaS foundation comparable to
  AMS IMPULSE platform strength without its product/provider domain.
Non-goals: business vertical, universal generator, production deployment,
  automatic merge, paid starter CI, hidden major upgrades.
Major outcomes: canonical docs; safe PostgreSQL proof foundation; identity/MFA;
  RLS tenant isolation; atomic commands; durable async; real evidence; dormant
  SourceCraft gates; hardened artifacts; UI/PWA safety; clean derivation; final
  conformance.
Epics: E00, E00A, E01–E11 (13 total).
Shared foundations: project profile, environment/version contract, test DB
  guard, PrincipalContext, scoped DB, command/repository boundary.
Data/schema: Better Auth transition, one-time setup/recovery, tenant constraints,
  RLS, runtime identities, outbox/job state and one regenerated pre-production
  baseline migration.
External integrations: no product provider; only SourceCraft delivery and local
  PostgreSQL/Playwright/Docker tooling with explicit preflights.
Security-sensitive areas: auth, Platform Admin, PII lifecycle, tenancy, RLS,
  secrets/logging/cache, recovery and destructive-target guards.
Infrastructure/release boundary: reusable local template only; publish, server,
  DNS, live DB and production are prohibited.
Known owner decisions: D-01, D-02, D-03 are DECIDED.
Unknown critical prerequisites: 0; tool availability is handled by preflight,
  fallback and local stop conditions.
```

### 10.2 Finding Register

| ID | Severity | Evidence / impact | Resolution | Owner | Status |
| --- | --- | --- | --- | --- | --- |
| F-01 | BLOCKER | v2 placed the real DB harness in E06 while E02–E05 required it to close, creating an execution/evidence cycle | extracted E00A; feature suites now belong to their epics and E06 only consolidates | no | RESOLVED |
| F-02 | MAJOR | v2 placed E07 in W3 but made it depend on E08 from W4 | E07 now consumes stable package scripts and no longer depends on E08 completion | no | RESOLVED |
| F-03 | MAJOR | epic-level dependencies did not model contract freeze, exact entry/exit or PR-only merge gates | added task shape `.C/.I/.V/.D/.M`, minimum blocking scope and shared-surface ownership | no | RESOLVED |
| F-04 | MAJOR | TypeScript 6 drift and version-sensitive API evidence were absent | E00 now owns exact version matrix, official evidence and explicit exception/downgrade decision | no | RESOLVED |
| F-05 | MAJOR | PII lifecycle, first-access provisioning, secret/image scan and connection budget were incomplete | guarantees and E00/E02/E07/E08 contracts expanded with deterministic evidence | no | RESOLVED |
| F-06 | QUESTION | `PR_ONLY` prevents dependent code from consuming an unmerged upstream PR | modeled as explicit `needs-owner` merge gates; stacked PR and auto-merge rejected | D-03 | ACCEPTED |

Open findings: `BLOCKER = 0`, `MAJOR = 0`, `NEEDS_OWNER = 0`.

### 10.3 Four Audit Passes

1. **Logic / Completeness — PASS.** Все 13 epics ведут к target guarantees;
   product-domain scope, production и generator остаются вне программы.
2. **Architecture / Data / Security — PASS.** Core Standard 3.4 boundaries,
   version drift, auth recovery, PII lifecycle, RLS rationale, DB identities,
   command atomicity и async ownership имеют отдельные contracts и evidence.
3. **Dependencies / Autonomy — PASS WITH DECLARED LIMIT.** Cycles = 0;
   contract-first links отделены от hard code dependencies; shared conflicts
   serialized; owner merge gates остаются неизбежным ограничением D-03.
4. **Executability / Evidence / Delivery — PASS.** Каждый epic имеет outcome,
   scope, dependency, acceptance, verification и PR-only delivery; общие
   entry/exit/rollback, external preflights и stop conditions определены.

### 10.4 Audit Scorecard

```text
Logic/completeness
  blockers: 0
  major open: 0
  epics mapped to goal: 13/13
Architecture/data/security
  blockers: 0
  major open: 0
  critical prerequisites without preflight/fallback: 0
Dependency/autonomy
  cycles: 0
  hard dependency groups: 9
  contract-first dependency groups: 8
  independent waves: 6
  single blocking points: owner merge gates required by D-03
Executability/evidence
  epics with acceptance: 13/13
  epics with verification: 13/13
  wired/live claims without reachableVia: 0
Owner decisions
  before approval open: 0
  later open: 0
Night Run Readiness: READY_WITH_LIMITS
Final audit result: PASS
```

### 10.5 Final Audit — Exact v4

**Audit input:** exact v4 at Git checkpoint
`486bfb82bfadf995268e0b6e71b7012489ac6e96`, current runtime source on
`origin/main`, E03 candidate head
`c4c8f0baec77d5c8d5e2a950687ded27dd94609c`, Task Manager v3 state and the
canonical helper at global `main`
`c0848e946448005d8dacbe7e252a9f1bc66af181`.

**Master plan map delta:** D-04 is resolved by moving exhaustive existing
runtime-context adoption, `NotificationRead` actor binding and separate
least-privilege non-human scopes into E03 before RLS activation. E04 owns only
new command/mutation wiring. Goals, non-goals, production boundary and
`PR_ONLY` policy do not change.

**Finding register:**

| ID | Severity | Evidence / impact | Recommendation | Owner | Status |
| --- | --- | --- | --- | --- | --- |
| F-07 | BLOCKER | E03 v3 enabled `FORCE RLS` before dashboard, readiness and worker paths adopted transaction-local principals | expand E03 to the exhaustive v4 runtime adoption map before merge | D-04 | RESOLVED |
| F-08 | BLOCKER | v3 E03 `.C/.I/.V/.D` contain closed ledgers while v4 changes their execution contract | canonical `Upgrade` now requires stable IDs, explicit reopen IDs and target reconciliation; full self-test proves dry-run → upgrade → CLEAN → NO_OP | D-05 | RESOLVED |

**Four audit passes:**

1. **Logic / Completeness — PASS.** D-04 closes the discovered broken-main
   sequence without weakening RLS, changing the product goal or moving
   production into implementation.
2. **Architecture / Data / Security — PASS.** Static runtime access inventory
   covers current direct protected-model consumers: identity membership,
   identity administration, project registry/tree, notifications,
   admin/operations, readiness and worker/retention. Negative worker and
   cross-actor evidence is explicit.
3. **Dependencies / Autonomy — PASS WITH DECLARED LIMIT.** Cycles remain zero;
   E03 → E04 is correctly HARD for implementation and D-03 owner merge gates
   remain the accepted sequential limit.
4. **Executability / Evidence / Delivery — PASS.** Global helper `Upgrade`
   performs preflight before writes, preserves old execution/review ledger
   notes, records `UPGRADE_LEDGER_V1` only for reopened closed work, supports
   dry-run and repeat-safe recovery, then demands `Reconcile = CLEAN`. Its full
   self-test covers partially completed multi-repository graph, dependency
   update, selective reopen and repeated `NO_OP`.

```text
Logic/completeness
  blockers: 0
  major open: 0
Architecture/data/security
  blockers: 0
  major open: 0
  current protected-model runtime surfaces mapped: PASS
Dependency/autonomy
  cycles: 0
  declared sequential limit: PR_ONLY owner merge gates
Executability/evidence
  blockers: 0
  v4 inventory upgrade path: tested and released
  CLEAN reconciliation: required after exact owner approval
Owner decisions
  before approval open: 0
Night Run Readiness: READY_WITH_LIMITS (PR_ONLY owner merge gates)
Final audit result: PASS
```

## 11. Risks And Stop Conditions

- Нельзя переносить migration history AMS IMPULSE целиком.
- Нельзя объявлять RLS/tenant security PASS по unit tests или schema text.
- Нельзя запускать paid SourceCraft workflows для EXPERIMENT starter.
- Нельзя использовать production/server secrets в template verification.
- Нельзя смешивать auth schema transition, RLS baseline и container release в
  одном PR.
- Нельзя работать напрямую в `main`; implementation использует отдельные
  branches/worktrees после APPROVED handoff.
- Неизвестный database target, runtime superuser, `BYPASSRLS`, secret в argv/log
  или production-only действие немедленно останавливают соответствующую task.
- Отсутствие Docker блокирует только artifact-specific proof, но не независимые
  docs/auth/data/test tasks.
- Потеря `bd 1.2.2` или failure Doctor блокирует approval import/handoff, но не
  изменяет канонический Markdown plan.

## 12. Revision History

### v0 — DRAFT — 2026-09-24

- Источник: существующий `docs/MASTER_PLAN.md`.
- Содержание: neutral baseline checklist и пять общих derivation steps.
- Решение: принят как существующая основа, недостаточная для автономного
  hardening execution.

### v1 — REVIEW — 2026-09-24

**Revision input ID:** OWNER-2026-09-24-01

**Source:** owner + repository assessment.

**Accepted:**

- усилить существующий `ams-microsaas-starter`, не обезличивать AMS IMPULSE;
- использовать AMS IMPULSE как donor проверенных platform/security/release
  contracts;
- сохранить neutral starter без business vertical;
- включить RLS, auth, async, evidence, runtime и derivation work в одну программу.

**Rejected:**

- простое копирование AMS IMPULSE;
- production deployment starter repository;
- paid CI до повышения delivery profile;
- сложный generator в первом проходе без evidence повторяемых вариантов.

**Open owner decisions:** D-01, D-02, D-03.

**Sections changed:** весь документ преобразован из checklist в versioned master
plan с goals, guarantees, waves, epic contracts, dependencies, decisions,
risks и evidence.

### v2 — REVIEW — 2026-09-24

**Revision input ID:** OWNER-2026-09-24-02

**Source:** explicit owner decisions.

**Accepted:**

- `outbox-plus-queue` остаётся обязательной частью strong starter;
- первая версия использует copy-source модель без generator;
- каждый epic завершается отдельным PR без автоматического merge;
- delivery policy программы зафиксирована как `PR_ONLY`.

**Rejected:**

- упрощение async foundation до queue-only baseline;
- generator в первой версии;
- автоматический merge epic PR после gate.

**Open owner decisions:** none.

**Sections changed:** target profile E05, derivation contract E10, delivery policy
и Owner Decision Register.

### v3 — APPROVED — 2026-09-24

**Revision input ID:** AUDIT-2026-09-24-01

**Source:** Task Manager Architect final audit of exact v2.

**Accepted:**

- вынести safe PostgreSQL test foundation в ранний E00A и устранить скрытый
  evidence cycle;
- развязать E07 и E08 по стабильным package script contracts;
- добавить import-time task shape, owner merge gates, external preflights и
  shared-file ownership;
- закрыть TypeScript 6/version evidence, PII lifecycle, provisioning,
  secret/image scan и connection-budget gaps;
- классифицировать Night Run Readiness как `READY_WITH_LIMITS` из-за явно
  выбранной политики `PR_ONLY`.

**Rejected:**

- automatic merge или stacked PR как обход D-03;
- Docker/WSL как обязательный local development default;
- скрытый downgrade TypeScript без отдельного compatibility decision.

**Open owner decisions:** none.

**Sections changed:** baseline gaps, guarantee matrix, waves, E00/E00A/E02/E03/
E06/E07/E08, dependency model, external prerequisites, Night Run Readiness и
final audit scorecard.

**Audit result:** PASS on exact v3.

**Approval:** owner approved exact v3 on 2026-09-24.

**Approved ready snapshot SHA-256:**
`c96aeae6b70db893f66422c8f8637b32136a432f484312f29a1a59c22c28be1f`.

### v4 — APPROVED — 2026-09-25

**Revision input ID:** FINDING-2026-09-24-01 / `ams-4tq` /
OWNER-2026-09-24-03

**Source:** pre-merge review of E03 exact head
`c4c8f0baec77d5c8d5e2a950687ded27dd94609c` and explicit owner decision.

**Finding:** E03 enables default-deny `FORCE RLS`, но существующие
platform-admin dashboard, readiness/health, outbox/reliability worker,
heartbeat и retention runtime paths ещё используют global Prisma без
transaction-local principal. Слияние текущего E03 нарушит работающие пути.

**Proposed correction:** E03 принимает полный wired adoption этих existing
runtime paths и отдельный least-privilege `system-job` principal до merge; E04
сохраняет ownership только новых command/mutation paths.

**Accepted by owner:** recommended E03 scope confirmed on 2026-09-24.

**Rejected:** broken intermediate `main`; weakening RLS/default-deny; перенос
обязательной runtime adoption в E04/E05; stacked PR как обход `PR_ONLY`.

**Open owner decisions:** none.

**Sections changed:** target guarantee matrix, delivery waves, E03/E04
contracts, exhaustive E03 runtime adoption map, dependency/ownership model,
Night Run Readiness and D-04.

**Final audit inputs:** `AUDIT-2026-09-25-01`, `AUDIT-2026-09-25-02`.

**Audit result:** PASS. F-08 is resolved by released global helper upgrade:
SourceCraft PR #77 passed `skill-risky`, is merged to global `main`
`c0848e9`, and the GitHub mirror has the same SHA. Exact v4 owner approval is
received on 2026-09-25; inventory creation, controlled graph upgrade and
Developer handoff are authorized.

**Approval:** owner approved exact v4 on 2026-09-25. The authorization covers
only the non-destructive v3 → v4 Beads `Upgrade`, reconciliation and autonomous
Developer execution in `PR_ONLY` mode. It does not authorize merge or production.

## 13. Current Architect State

```text
Phase: EXECUTION
Final audit: PASS for v4 at 486bfb82 (AUDIT-2026-09-25-02)
Readiness verdict: APPROVED
Owner decisions before approval: 0; owner approval received 2026-09-25
Beads CLI: PASS, bd 1.2.2
Beads graph: v3 evidence is frozen; it is not v4 execution authority
Task Manager import: controlled v3 → v4 `Upgrade` is authorized
Developer handoff: authorized only after CLEAN reconciliation after import
Production: prohibited
Next: inventory → dry-run Upgrade → Upgrade → Reconcile CLEAN → Developer
  handoff
```
