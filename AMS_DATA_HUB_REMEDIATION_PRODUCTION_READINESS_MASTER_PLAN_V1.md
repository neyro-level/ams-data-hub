# AMS DATA HUB — REMEDIATION & PRODUCTION READINESS MASTER PLAN

Plan ID: AMS-DATA-HUB-REMEDIATION-2026-10
Version: v1
Status: APPROVED
Approved by: owner
Approved at: 2026-10-06

Execution boundary: remediation and non-production verification only. Production
rollout requires a separate explicit owner release command after MP-10 PASS.
Supersedes as active execution program: AMS-DATA-HUB-IMPLEMENTATION-2026-01 v4.
The completed v4 graph and its approval artifact remain historical evidence.

**Версия:** 1.0  
**Дата:** 2026-10-06  
**Основание:** аудит `ams-data-hub` HEAD `4f2224b4996bceabc1bb28ed139f68a94b67d48d`  
**Цель:** довести текущий репозиторий до полностью рабочего AMS Data Hub, готового принимать реальные источники, обслуживать проекты, формировать production snapshot и подключать первый REALTY LITE consumer.

---

# 0. OWNER DECISIONS

Следующие решения считаются утверждёнными и не требуют повторного обсуждения.

```text
2FA / TOTP
→ НЕ входит в текущую версию
→ убрать обязательность и runtime-логику
→ возможный будущий epic

YRL / Vladis
→ оставить

Domclick XML
→ оставить

Avito XML
→ оставить

CIAN XML
→ оставить

Newbuilding Import Foundation
→ оставить и развивать

descriptionHtmlSafe
→ оставить
→ разрешён только после строгой sanitization allowlist

AMS Data Hub
→ довести до реально рабочего состояния

REALTY LITE
→ отдельный репозиторий
→ сейчас не перерабатывается
→ проверяются только Hub contracts
```

---

# 1. ЧТО НЕ НУЖНО ПЕРЕПИСЫВАТЬ

Текущий фундамент сохраняется.

Не делать greenfield rewrite.

Сохранить:

- modular monolith;
- Next.js / TypeScript;
- Prisma / PostgreSQL;
- tenancy;
- RLS;
- Platform Admin;
- Source Registry;
- SourceAdapter / SourceProfile;
- YRL streaming parser;
- Safety Engine;
- Inventory Identity;
- inventory lifecycle grace;
- Agent domain;
- Agent matching;
- ProjectPublicContact;
- Project URL Registry;
- Project Editorial;
- Media Mirror;
- Safe Outbound security model;
- transactional outbox;
- pg-boss;
- Snapshot contracts;
- Ed25519 signing;
- `keyId`;
- signing-key rotation;
- ACK contracts;
- ProjectExitBundleV1;
- Timeweb S3 project isolation;
- SourceCraft release contour;
- существующие unit/integration/security tests.

Цель плана:

```text
не заменить архитектуру
↓
а соединить уже построенные части
↓
в один реальный operational pipeline
```

---

# 2. КРИТИЧЕСКИЙ ПУТЬ

```text
MP-00 Canon sync
       ↓
MP-01 Remove current 2FA requirement
       ↓
MP-02 Streaming Safe Intake
       ↓
MP-03 Production Source Runtime
       ↓
MP-04 Source Worker + Scheduler
       ↓
MP-05 Snapshot Assembly
       ↓
MP-06 Public Contract / Media / HTML fixes
       ↓
MP-07 Snapshot Consumer Security Hardening
       ↓
MP-08 Operations Executors + Delivery API
       ↓
MP-09 Full E2E Production Proof
       ↓
MP-10 Production Readiness Gate
```

`MP-02`, часть `MP-06` и `MP-07` могут выполняться параллельно.

---

# EPIC MP-00 — CANON / SOURCE OF TRUTH RECONCILIATION

## Goal

Привести документы проекта в соответствие с фактическими owner decisions до дальнейшей разработки.

## Tasks

### MP-00.1 — Зафиксировать решение по 2FA

В `00_CONSTITUTION.MD.md`:

```text
OQ-09

Current release:
2FA/TOTP = NOT IMPLEMENTED / NOT REQUIRED

Status:
DEFERRED

Revisit:
post-pilot / explicit owner decision
```

Не объявлять 2FA постоянным архитектурным требованием.

### MP-00.2 — Зафиксировать дополнительные feed profiles

Документально утвердить:

```text
YRL
Domclick
Avito v3
CIAN v2
```

как разрешённые production adapter/profile families.

При этом сохранить правило:

```text
producer-specific behavior
→ SourceProfile

format-specific behavior
→ SourceAdapter

project-specific if/else inside parser core
→ forbidden
```

### MP-00.3 — Зафиксировать Newbuilding Import Foundation

Определить его как разрешённый Hub capability:

```text
input
→ staging
→ dry-run
→ reviewed plan hash
→ explicit manual apply
→ audit/revision
```

Не превращать его пока в автоматический uncontrolled ingestion.

### MP-00.4 — Синхронизировать документы

Проверить:

- `00_CONSTITUTION.MD.md`;
- `01_PRD.md`;
- `03_ARCHITECTURE.md`;
- `04_BACKLOG.md`;
- `SECURITY.md`;
- `OPERATIONS.md`;
- `DELIVERY_STATE.yaml`;
- ADR index.

Удалить утверждения, что runtime уже полностью готов, если конкретный executor ещё отсутствует.

## Acceptance

```text
docs describe actual code
owner decisions do not conflict
no document claims 2FA is mandatory
no document claims missing runtime executor is complete
```

---

# EPIC MP-01 — REMOVE CURRENT 2FA / TOTP REQUIREMENT

**Priority:** P0

## Goal

Вернуть authentication contour к текущему owner decision:

```text
username/password
+
server-side authorization
+
rate limiting
+
account/session security
```

без обязательного TOTP.

## Tasks

### MP-01.1 — Better Auth

Убрать TOTP plugin из:

```text
src/platform/auth/auth.ts
src/platform/auth/client.ts
```

Не ломать:

- password auth;
- sessions;
- username login;
- disabled-user protection;
- rate limiting;
- CSRF/origin protection.

### MP-01.2 — Login UI

Убрать TOTP branch из:

```text
LoginDialog.tsx
```

Flow:

```text
username/password
→ valid session
→ authorization
→ application
```

### MP-01.3 — Principal

Убрать требование:

```text
PLATFORM_ADMIN
→ platformAdminMfaVerified
```

из authorization path.

Platform Admin определяется:

```text
fresh session
+
enabled user
+
systemRole = PLATFORM_ADMIN
```

### MP-01.4 — Environment

Удалить runtime requirement:

```text
ADMIN_TOTP_REQUIRED
```

из:

- env schema;
- `.env.example`;
- runtime validation;
- deployment checks.

### MP-01.5 — Database cleanup

Создать **новую forward migration**.

Не переписывать старую Git migration history.

Проверить возможность удалить:

```text
TwoFactor
User.twoFactorEnabled
Session.twoFactorVerifiedAt
```

Если Better Auth без 2FA plugin не требует эти поля — удалить.

### MP-01.6 — Recovery

Сохранить безопасный account/password recovery, если он нужен.

Удалить только TOTP-specific:

```text
factor reset
factor re-enrollment
factor recovery logic
```

### MP-01.7 — Tests

Пересобрать:

- auth unit;
- auth integration;
- E2E login;
- Platform Admin access;
- account recovery;
- RLS runtime grants.

Удалить test hacks типа ручного:

```text
twoFactorVerifiedAt = now()
```

## Acceptance

```text
Platform Admin logs in by username/password
no TOTP challenge
no ADMIN_TOTP_REQUIRED
no runtime 2FA requirement
auth security remains fail-closed
rate limits remain
disabled users remain blocked
```

---

# EPIC MP-02 — STREAMING SAFE INTAKE

**Priority:** P0

## Problem

Сейчас XML parser действительно streaming, но общий Safe Outbound fetch собирает HTTP body целиком в RAM.

Это создаёт несоответствие:

```text
Parser:
до ~256 MB, streaming

Safe Outbound:
полный response → Uint8Array
```

## Goal

Большой feed никогда не должен целиком жить в памяти процесса.

## Tasks

### MP-02.1 — Разделить outbound modes

Сохранить:

```text
safeOutboundBuffered()
```

для небольших файлов/media.

Добавить:

```text
safeOutboundStream()
```

для feed ingestion.

### MP-02.2 — Безопасность streaming режима

Сохранить все существующие проверки:

- HTTPS policy;
- DNS resolve;
- second DNS validation;
- socket pinning;
- private IP blocking;
- IPv4-mapped IPv6 protection;
- redirect re-check;
- timeout;
- maximum bytes;
- content type.

### MP-02.3 — Stream raw artifact

Pipeline:

```text
remote feed
↓
Safe Outbound stream
↓
hash SHA-256 incrementally
↓
raw artifact storage
↓
parser stream
```

Не делать:

```text
remote XML
→ 200 MB Buffer
→ parser
```

### MP-02.4 — Raw artifact limits

Размер Source должен ограничиваться SourceSafety/adapter policy.

### MP-02.5 — Tests

Обязательно:

```text
large feed does not allocate full feed buffer
oversized stream aborts
timeout aborts stream
redirect to private IP blocked
truncated stream fails
raw hash deterministic
```

## Acceptance

Feed размером десятки/сотни MB обрабатывается с bounded memory.

---

# EPIC MP-03 — PRODUCTION SOURCE RUNTIME COMPOSITION

**Priority:** P0

## Problem

`runSourceImport()` существует как качественный orchestrator, но production dependency composition отсутствует.

## Goal

Создать реальный use case:

```text
Source
↓
SecretRef endpoint
↓
Safe Intake
↓
Raw Artifact
↓
Adapter
↓
Profile
↓
Normalize
↓
Identity
↓
Safety
↓
Staging
↓
MutationPlan
↓
GOOD SourceRevision
↓
Snapshot Build Request
```

## Tasks

### MP-03.1 — SourceExecutionService

Создать единый application service.

Он получает:

```text
organizationId
projectId
sourceId
```

И сам разрешает:

- source config;
- SecretRef;
- adapter;
- profile;
- safety policy;
- last-good revision.

### MP-03.2 — Credential resolution

Feed endpoint:

```text
Source.endpointCredentialRef
↓
SecretRef
↓
server-only resolver
```

URL не должен попадать:

- в UI;
- в audit;
- в job payload;
- в logs;
- в snapshot.

### MP-03.3 — Adapter Registry integration

Runtime должен выбирать адаптер только через registry:

```text
adapterKey
adapterVersion
profileKey
profileVersion
```

### MP-03.4 — Concrete pipeline adapters

Подключить реальные implementations:

- safe intake;
- raw artifact store;
- parser;
- validator;
- normalizer;
- identity resolver;
- Safety Engine;
- staging;
- mutation planner;
- GOOD revision persistence.

### MP-03.5 — Last Good

Broken run:

```text
-X→ replace Last Good
-X→ mass deactivate
-X→ empty current inventory
```

### MP-03.6 — Snapshot trigger

После GOOD:

```text
transaction commit
↓
outbox event
↓
snapshot.build.request
```

Не выполнять внешнюю публикацию внутри import DB transaction.

### MP-03.7 — Runtime tests

Real composition tests для:

- YRL/Vladis;
- Domclick;
- Avito;
- CIAN.

## Acceptance

Production Source можно зарегистрировать configuration-only и запустить без test-only dependency injection.

---

# EPIC MP-04 — SOURCE WORKER + SCHEDULER RUNTIME

**Priority:** P0

## Problem

Очередь и scheduler реализованы, но production worker их не исполняет.

## Goal

Source jobs становятся реальной частью worker runtime.

## Tasks

### MP-04.1 — Worker command

Добавить runtime mode:

```text
source-worker
```

или единый worker orchestration, где pg-boss consumers запускаются вместе.

### MP-04.2 — Source queue consumer

Подключить:

```text
drainSourceJobQueue()
```

к реальному pg-boss.

### MP-04.3 — Scheduler reconciliation

На startup и/или отдельной maintenance job:

```text
Source config
↓
reconcileSchedules()
↓
pg-boss schedules
```

### MP-04.4 — Manual Source run

`Run Source` в Admin должен реально:

```text
request
↓
queue
↓
worker
↓
SourceExecutionService
```

### MP-04.5 — Concurrency

Один Source не должен импортироваться параллельно сам с собой.

Использовать:

- pg-boss singleton;
- DB/advisory protection где необходимо.

### MP-04.6 — Shutdown

Graceful shutdown:

```text
SIGTERM
→ stop fetch
→ finish/abort controlled job
→ release locks
```

### MP-04.7 — Health

Worker readiness показывает:

- pg-boss connected;
- source consumer active;
- heartbeat current.

## Acceptance

```text
schedule
→ job
→ worker
→ real import
→ GOOD revision
```

работает без ручного вызова test helpers.

---

# EPIC MP-05 — REAL SNAPSHOT ASSEMBLY

**Priority:** P0 — главный отсутствующий слой

## Goal

Создать настоящий:

```text
Hub DB
↓
SnapshotInputResolver
↓
Public Dataset Projectors
↓
composeSnapshot()
↓
sign
↓
store
↓
publish
```

## Tasks

### MP-05.1 — SnapshotInput

Зафиксировать точные inputs snapshot:

```text
catalogRevision
approved SourceRevision[]
project state revision
publishSequence
schema version
```

Snapshot обязан быть воспроизводимым.

### MP-05.2 — Dataset Projectors

Создать projectors для всех contract datasets:

```text
geo
developers
developments
buildings
prices
media
inventory
agents
project/contacts
editorial
urls
redirects
lifecycle
```

### MP-05.3 — Shared Catalog selection

Учитывать:

```text
ALL_SHARED
CURATED
include/exclude
```

### MP-05.4 — Source composition

Для каждого Source использовать policy-approved Last Good.

Broken Source не должен удалять данные остальных Sources.

### MP-05.5 — Inventory public projection

Только:

```text
PublicInventoryDTO
```

Никаких raw Prisma rows.

### MP-05.6 — Agent publication gate

Snapshot Agent допускается только:

```text
ACTIVE
AND showOnSite
AND publication/consent gate PASS
```

Если gate не пройден:

```text
listing remains
agent personal block omitted
ProjectPublicContact fallback available
```

### MP-05.7 — ProjectPublicContact

Если flow требует fallback:

```text
project/contacts
```

обязателен.

### MP-05.8 — URL/Lifecycle

Snapshot получает persistent state из Hub, но не SEO-policy.

### MP-05.9 — Sequence lock

Для одного Project нельзя одновременно получить два snapshot с одинаковым sequence.

Использовать DB transaction/advisory lock.

### MP-05.10 — Compose + Sign

После projectors:

```text
composeSnapshot()
↓
privacy verification
↓
referential integrity
↓
Ed25519 signing
```

### MP-05.11 — Publication

```text
immutable artifacts
↓
manifest
↓
current pointer
↓
DeliveryRun
```

## Acceptance

В production code есть реальный вызов `composeSnapshot()`.

Не только tests.

---

# EPIC MP-06 — PUBLIC CONTRACT CORRECTIONS

**Priority:** P0/P1

## MP-06A — `descriptionHtmlSafe`

### Problem

Sanitizer допускает:

```text
p
br
ul
ol
li
strong
em
```

Но snapshot privacy scanner сейчас блокирует любой HTML.

### Tasks

Разделить:

```text
raw HTML
→ FORBIDDEN

descriptionHtmlSafe
→ ALLOWED after sanitizer contract
```

Privacy scanner не должен пытаться повторно быть HTML sanitizer.

Правильная граница:

```text
ingestion sanitizer
↓
typed descriptionHtmlSafe
↓
public DTO
↓
snapshot
```

Добавить tests:

```text
<p>text</p> → PASS
<strong>text</strong> → PASS
<script> → impossible after sanitizer / FAIL
onclick= → FAIL
href → FAIL
rawDescriptionHtml → FAIL
```

---

## MP-06B — PUBLIC MEDIA CONTRACT

### Problem

Public inventory contract сейчас содержит:

```text
media[].sourceUrl
```

Это опасно архитектурно.

Source URL должен оставаться provenance.

### Tasks

Создать канонический public media contract, например:

```text
MediaPublicV1

uid/ref
kind
url/storageRef
width?
height?
position
alt?
```

Конкретное имя согласовать с существующими contracts.

Главное:

```text
sourceUrl
-X→ PublicInventoryDTO
```

### MP-06.3 — Snapshot media projection

```text
MediaSource
↓
MediaAsset
↓
mirrored object
↓
public media projection
```

### MP-06.4 — Inventory relation

Inventory должен ссылаться только на mirrored/public media.

### MP-06.5 — Failure semantics

Если отдельная картинка не скачалась:

```text
inventory remains valid
media warning recorded
broken source URL not exposed as production fallback
```

### MP-06.6 — Independence proof

Отключить producer media host в test environment.

Snapshot/catalog всё равно должен иметь рабочую media representation.

## Acceptance

Public snapshot нигде не требует original producer image URL.

---

# EPIC MP-07 — SNAPSHOT VERIFIER HARDENING

**Priority:** P1

## Problem

Portable verifier делает `gunzipSync()` без ограничения распакованного размера.

## Goal

Consumer verification должен быть bounded даже для криптографически корректного, но злонамеренного/ошибочного artifact.

## Tasks

### MP-07.1 — Limits

Добавить policy:

```text
maxCompressedFileBytes
maxDecompressedFileBytes
maxDatasetRecords
maxTotalSnapshotBytes
```

### MP-07.2 — Bounded decompression

Не позволять gzip распаковаться без лимита.

Предпочтительно streaming/bounded gunzip.

### MP-07.3 — Manifest preflight

До decompression проверить:

- file set;
- duplicate kinds;
- declared bytes;
- hash;
- supported schema;
- publish sequence;
- projectId;
- key trust.

### MP-07.4 — Adversarial tests

```text
gzip bomb
huge JSON
huge record count
duplicate dataset
wrong bytes
wrong sha
invalid gzip
unknown schema major
revoked key
lower sequence
```

## Acceptance

Malformed snapshot не может вызвать uncontrolled memory growth.

---

# EPIC MP-08 — OPERATIONS EXECUTORS + SNAPSHOT DELIVERY API

**Priority:** P0/P1

## Problem

Admin сейчас умеет создавать operational requests, но для ряда операций executor отсутствует.

## Goal

Каждая кнопка Operations UI приводит либо к выполненной операции, либо к явному FAILED state.

## MP-08.1 — Operational outbox consumers

Реализовать executors:

```text
SNAPSHOT_BUILD
SNAPSHOT_PUBLISH
SNAPSHOT_ROLLBACK
ACK_ROTATE
SUSPICIOUS_APPROVE
SUSPICIOUS_REJECT
```

### MP-08.2 — Snapshot Build executor

Вызывает MP-05 Snapshot Assembly.

### MP-08.3 — Snapshot Publish executor

Публикует только уже валидный signed snapshot.

### MP-08.4 — Rollback

Использовать существующее правило:

```text
old approved content
→ new snapshot
→ higher publishSequence
```

Никакого уменьшения sequence.

### MP-08.5 — ACK rotation

Реально выполнять:

```text
current
+
next
→ overlap
→ promote
```

### MP-08.6 — Action state

Для operational request ввести понятный lifecycle:

```text
REQUESTED
RUNNING
SUCCEEDED
FAILED
```

UI должен отличать:

```text
«Запрос создан»
```

от:

```text
«Snapshot опубликован»
```

### MP-08.7 — Consumer Delivery API

Добавить server-side project authenticated endpoints/handlers для:

```text
current manifest discovery
immutable artifact access
ACK
```

Не отдавать:

- DB;
- internal APIs;
- unrelated project artifacts.

### MP-08.8 — ACK HTTP boundary

Подключить существующий `createSnapshotAckService()` к реальному route handler.

Проверять:

```text
project credential
projectId
publishSequence
idempotency key
```

### MP-08.9 — Webhook notifier

Webhook:

```text
projectId
publishSequence
```

никаких datasets.

Webhook failure:

```text
-X→ rollback publication
```

Polling остаётся fallback.

### MP-08.10 — SUSPENDED

Проверить:

```text
SUSPENDED
→ no new ingestion
→ no new publish
→ existing current snapshot remains readable
```

## Acceptance

Operations UI больше не является декоративной системой запросов.

---

# EPIC MP-09 — REAL END-TO-END PROOF

**Priority:** P0 перед production

## Goal

Доказать не отдельные modules, а полный контур.

## Scenario A — Bastion / Vladis

```text
real Source config
↓
SecretRef
↓
worker
↓
Safe Intake
↓
raw artifact
↓
YRL parser
↓
vladis profile
↓
normalized inventory
↓
agents
↓
media mirror
↓
GOOD SourceRevision
↓
Snapshot Build
↓
sign
↓
publish
↓
current manifest
↓
ACK simulation
```

### Проверить

- все property types;
- SALE/RENT;
- internal-id stability;
- missing-run grace;
- private apartment exclusion;
- deterministic public geo;
- safe HTML;
- agent matching;
- office-phone collision;
- consent gate;
- ProjectPublicContact;
- media order;
- broken image semantics.

## Scenario B — Domclick

Проверить:

```text
format/profile boundary
normalized DTO compatibility
```

## Scenario C — Avito v3

То же.

## Scenario D — CIAN v2

То же.

## Scenario E — Newbuilding Import

```text
input
↓
dry-run
↓
diff
↓
review hash
↓
manual confirmation
↓
transaction apply
↓
catalog revision
↓
snapshot
```

## Scenario F — Broken Source

```text
good A
good B
broken C
↓
snapshot
A current GOOD
B current GOOD
C previous Last Good
```

## Scenario G — Restart

```text
worker restart
web restart
pg-boss restart
```

не должны терять durable state.

## Acceptance

Нет test-only shortcuts.

---

# EPIC MP-10 — PRODUCTION READINESS GATE

## Goal

После этого epic проект можно считать готовым к подключению первого production consumer.

## 10.1 Code Gate

Обязательный PASS:

```text
pnpm verify:quick
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm build
pnpm worker:build
pnpm architecture:check
pnpm security:semgrep
pnpm security:dependencies
pnpm verify:rls-coverage
pnpm docs:check
```

## 10.2 Security Gate

Доказать:

```text
tenant A cannot read B
S3 A cannot read B
feed SSRF blocked
redirect SSRF blocked
XXE blocked
secrets absent from logs
private apartment absent from snapshot
agent private evidence absent
raw feed HTML absent
source media URL absent from public DTO
snapshot gzip bomb rejected
revoked signing key rejected
```

## 10.3 Data Safety Gate

Обязательны:

```text
PostgreSQL backup configured
restore drill PASS
S3 policy configured
raw artifact retention configured
jobs freeze/unfreeze PASS
identity reconcile PASS
publicUrlId reconcile PASS
```

## 10.4 Runtime Gate

Доказать:

```text
Source schedule
→ actual worker
→ actual import
→ GOOD revision
→ actual snapshot
→ signed manifest
→ storage
→ delivery state
```

## 10.5 Portability Gate

Существующий ProjectExitBundleV1 proof повторить на финальном контракте.

```text
Hub OFF
AMS credentials absent
DATA_MODE=local
→ exported consumer data remains valid
```

## 10.6 Operations Gate

Из Admin без SSH можно:

- увидеть Source status;
- запустить Source;
- увидеть Import result;
- увидеть issues;
- Build Snapshot;
- Publish Snapshot;
- увидеть Delivery;
- выполнить rollback;
- увидеть ACK;
- увидеть alerts;
- проверить audit.

---

# 3. ОБЯЗАТЕЛЬНЫЕ REGRESSION GUARDS

Добавить проверки, которые не позволят проекту снова разойтись с Конституцией.

## Architecture guards

Запрещать:

```text
client-specific parser
projectId branching inside adapter
direct fetch outside Safe Outbound
raw Prisma row → public snapshot
sourceUrl → public inventory media
private fields → public datasets
```

## Snapshot guards

```text
13 canonical datasets required
privacy projection required
referential integrity required
signature required
publishSequence monotonic
```

## Runtime guards

CI должен ловить ситуацию:

```text
module exists
but production composition absent
```

Для ключевых capabilities нужны smoke tests через реальные public application entrypoints.

---

# 4. ЧТО СЧИТАТЬ ТЕХНИЧЕСКИМ ДОЛГОМ ПОСЛЕ ПЛАНА

После выполнения MP-00 — MP-10 **не оставлять как debt**:

- 2FA dead code;
- unused TOTP DB schema;
- test-only Snapshot Composer;
- test-only Source job worker;
- unconsumed Operations events;
- `sourceUrl` в public media;
- unlimited gzip decompression;
- full feed buffering;
- docs claiming readiness earlier than runtime.

Можно отложить:

- client UI access;
- advanced media GC;
- generic CSV importer;
- generic XLSX importer;
- API ingestion;
- FULL/Payload destination;
- automatic AI enrichment;
- automatic agent merge;
- microservices;
- Kubernetes.

---

# 5. DEFINITION OF DONE — AMS DATA HUB

Проект считается действительно готовым только когда одновременно выполнено:

```text
1. Source можно создать configuration-only.

2. Feed credential хранится как SecretRef.

3. Feed реально запускается worker'ом.

4. Feed обрабатывается streaming.

5. Broken feed не заменяет Last Good.

6. Inventory identity стабильна.

7. Missing object проходит grace.

8. Agents matching безопасный.

9. Media зеркалируется.

10. Public media не зависит от source CDN.

11. ProjectPublicContact работает.

12. Shared Catalog работает.

13. Newbuilding manual import работает.

14. Snapshot реально собирается из DB state.

15. Snapshot содержит все canonical datasets.

16. Safe descriptionHtmlSafe проходит snapshot.

17. Private/raw data не проходит.

18. Snapshot подписывается Ed25519.

19. keyId rotation/revocation работает.

20. publishSequence монотонный.

21. Snapshot реально публикуется.

22. Project storage изолирован.

23. Current manifest можно получить project-scoped способом.

24. ACK route реально работает.

25. Operations actions имеют executor.

26. Rollback создаёт новый higher sequence.

27. SUSPENDED не ломает current artifact.

28. Restore drill проходит.

29. Exit Bundle проходит.

30. Все release/security/integration gates зелёные.
```

После этого статус может быть изменён на:

```text
AMS DATA HUB
PRODUCTION READY
READY FOR FIRST REALTY LITE CONSUMER
```

---

# 6. РЕКОМЕНДУЕМЫЙ ПОРЯДОК РЕАЛИЗАЦИИ

Не выполнять всё одновременно.

## WAVE 1 — исправить source of truth

```text
MP-00
MP-01
```

## WAVE 2 — оживить ingestion

```text
MP-02
MP-03
MP-04
```

После Wave 2:

```text
реальный Source уже должен запускаться автоматически
```

## WAVE 3 — оживить snapshot

```text
MP-05
MP-06
MP-07
```

После Wave 3:

```text
Hub реально способен построить безопасный production snapshot
```

## WAVE 4 — operations и delivery

```text
MP-08
```

После Wave 4:

```text
Admin → operation → executor → snapshot → delivery
```

становится законченной системой.

## WAVE 5 — доказательство

```text
MP-09
MP-10
```

Только после этого разрешать production rollout.

---

# 7. ИТОГОВАЯ АРХИТЕКТУРА

```text
                 AMS DATA HUB

 Source Registry
       │
       ▼
 SecretRef Resolver
       │
       ▼
 Safe Streaming Intake
       │
       ├── raw artifact
       │
       ▼
 SourceAdapter
       │
 SourceProfile
       │
       ▼
 Normalize / Validate
       │
       ▼
 Identity / Safety
       │
       ▼
 Project Fact State
       │
       ├── Inventory
       ├── Agents
       ├── Media
       ├── Editorial
       ├── Contacts
       ├── URLs
       └── Lifecycle
       │
       │
 Shared Catalog
       │
       ▼
 Snapshot Input Resolver
       │
       ▼
 Public Dataset Projectors
       │
       ▼
 Privacy + Contract Gate
       │
       ▼
 composeSnapshot
       │
       ▼
 Ed25519 Sign
       │
       ▼
 Immutable Project Storage
       │
       ▼
 Current Manifest
       │
       ├── webhook
       ├── polling
       └── ACK
```

Это и является целевым рабочим AMS Data Hub.
