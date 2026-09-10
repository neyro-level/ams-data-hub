# DATA MODEL

## Источники истины

- `prisma/schema.prisma` — фактическая структура PostgreSQL;
- `prisma/migrations/*` — immutable история изменений schema;
- `src/shared/schemas/*` — runtime DTO validation;
- этот документ — назначение, связи, lifecycle и invariants;
- operator configuration — private external input для explicit `config:sync`, не production runtime store;
- `config/examples/**` и test fixtures содержат только synthetic data; verifier запрещает private operator paths и известные client signatures в tracked tree.

PostgreSQL — единственный runtime source of truth.

## DateTime contract

Audit updated: `2026-09-07`. Prisma version: `7.10.0`. После удаления compatibility auth schema в schema осталось 81 поле `DateTime`: 17 доказанных UTC instant полей используют PostgreSQL `timestamptz(3)`, остальные 64 остаются `timestamp(3)` (`timestamp without time zone`). Prisma default mapping для PostgreSQL задаёт `DateTime → timestamp(3)`; timezone-aware mapping задан явно через `@db.Timestamptz(3)`.

Нормативные источники: [Prisma PostgreSQL type mapping](https://docs.prisma.io/docs/orm/v6/overview/databases/postgresql), [Prisma 7 native database types](https://docs.prisma.io/docs/orm/v7/prisma-migrate/workflows/native-database-types), [PostgreSQL 18 date/time types](https://www.postgresql.org/docs/18/datatype-datetime.html).

PostgreSQL не сохраняет timezone в `timestamp without time zone` и игнорирует offset при приведении входа к этому типу. `timestamptz` хранит instant в UTC, но преобразование старого `timestamp` использует session `TimeZone`, если зона не указана явно. Поэтому 12B может применять только явную семантику `USING <column> AT TIME ZONE 'UTC'` и только к полям с доказанным UTC-origin; слепое изменение native type запрещено.

Статусы:

- `TIMESTAMPTZ_UTC` — writers передают JS `Date` либо ISO/RFC3339 instant с `Z`/offset; conversion на копии production backup сохранил epoch и null-shape;
- `KEEP_TIMESTAMP` — значение является civil date, а не instant; timezone задаёт provider/site contract, поэтому автоматический переход на `timestamptz` изменит смысл;
- `REQUIRES_CHECK` — старые production-значения или все writers не доказаны; migration запрещена до read-only проверки database/session timezone и выборки данных.

| Model.fields | Бизнес-смысл | Источник timezone / UTC proof | Стратегия | Статус |
|---|---|---|---|---|
| `User.disabledAt` | момент административной блокировки | admin CLI передаёт `new Date()` | `timestamptz(3)`, explicit `AT TIME ZONE 'UTC'` | TIMESTAMPTZ_UTC |
| `User.createdAt`, `User.updatedAt` | создание/последнее изменение identity | DB `now()` / Prisma `@updatedAt`; historical session timezone не доказан | не менять; проверить production timezone и samples | REQUIRES_CHECK |
| `Session.expiresAt`, `Session.createdAt`, `Session.updatedAt` | Better Auth session lifecycle | Better Auth-owned writer; historical adapter/session timezone не доказан | не менять; сверить production rows и Better Auth adapter | REQUIRES_CHECK |
| `Account.accessTokenExpiresAt`, `Account.refreshTokenExpiresAt`, `Account.createdAt`, `Account.updatedAt` | Better Auth account/token lifecycle | Better Auth-owned writer; provider offsets и historical rows не доказаны | не менять; сверить provider/adapter writers | REQUIRES_CHECK |
| `Verification.expiresAt`, `Verification.createdAt`, `Verification.updatedAt` | Better Auth verification lifecycle | Better Auth-owned writer; historical rows не доказаны | не менять; проверить adapter и samples | REQUIRES_CHECK |
| `Organization.createdAt`, `Organization.updatedAt` | tenant record audit time | DB `now()` / Prisma `@updatedAt`; historical session timezone не доказан | не менять до production proof | REQUIRES_CHECK |
| `Member.createdAt`, `Member.updatedAt` | membership audit time | DB `now()` / Prisma `@updatedAt`; historical session timezone не доказан | не менять до production proof | REQUIRES_CHECK |
| `ThresholdProfile.createdAt`, `ThresholdProfile.updatedAt` | threshold profile audit time | DB `now()` / Prisma `@updatedAt`; historical session timezone не доказан | не менять до production proof | REQUIRES_CHECK |
| `QueryClusterProfile.createdAt`, `QueryClusterProfile.updatedAt` | cluster profile audit time | DB `now()` / Prisma `@updatedAt`; historical session timezone не доказан | не менять до production proof | REQUIRES_CHECK |
| `QueryClusterGroup.createdAt`, `QueryClusterGroup.updatedAt` | cluster group audit time | DB `now()` / Prisma `@updatedAt`; historical session timezone не доказан | не менять до production proof | REQUIRES_CHECK |
| `Project.createdAt`, `Project.updatedAt` | project audit time | DB `now()` / Prisma `@updatedAt`; historical session timezone не доказан | не менять до production proof | REQUIRES_CHECK |
| `Site.createdAt`, `Site.updatedAt` | site audit time | DB `now()` / Prisma `@updatedAt`; `Site.timezone` is business configuration, not proof for these instants | не менять до production proof | REQUIRES_CHECK |
| `ProviderConnection.createdAt`, `ProviderConnection.updatedAt` | provider mapping audit time | DB `now()` / Prisma `@updatedAt`; historical session timezone не доказан | не менять до production proof | REQUIRES_CHECK |
| `ProviderConnection.lastCheckedAt`, `ProviderConnection.connectedAt`, `ProviderOperation.startedAt`, `ProviderOperation.finishedAt` | фактические provider lifecycle instants | worker JS `Date` | `timestamptz(3)` | TIMESTAMPTZ_UTC |
| `ProviderOperation.createdAt`, `ProviderOperation.updatedAt`, `SearchTarget.createdAt`, `SearchTarget.updatedAt` | audit/configuration time | DB `now()` / Prisma `@updatedAt`; historical session timezone не доказан | не менять до production proof | REQUIRES_CHECK |
| `GoalDefinition.createdAt`, `GoalDefinition.updatedAt` | goal configuration audit time | DB `now()` / Prisma `@updatedAt`; historical session timezone не доказан | не менять до production proof | REQUIRES_CHECK |
| `TrackedQuerySet.createdAt`, `TrackedQuerySet.updatedAt` | query-set audit time | DB `now()` / Prisma `@updatedAt`; historical session timezone не доказан | не менять до production proof | REQUIRES_CHECK |
| `TrackedQuery.createdAt`, `TrackedQuery.updatedAt` | tracked-query audit time | DB `now()` / Prisma `@updatedAt`; historical session timezone не доказан | не менять до production proof | REQUIRES_CHECK |
| `SyncRun.startedAt`, `SyncRun.finishedAt` | фактические границы полного sync | worker injects `new Date().toISOString()`; repository constructs JS `Date` | `timestamptz(3)`, explicit `AT TIME ZONE 'UTC'` | TIMESTAMPTZ_UTC |
| `SyncRun.createdAt`, `SyncRun.updatedAt` | sync record audit time | DB `now()` / Prisma `@updatedAt`; historical session timezone не доказан | не менять до production proof | REQUIRES_CHECK |
| `SourceRun.startedAt`, `SourceRun.finishedAt` | фактические границы provider execution | worker ISO instant with `Z`; repository constructs JS `Date` | `timestamptz(3)`, explicit `AT TIME ZONE 'UTC'` | TIMESTAMPTZ_UTC |
| `SourceRun.createdAt`, `SourceRun.updatedAt` | source-run audit time | DB `now()` / Prisma `@updatedAt`; historical session timezone не доказан | не менять до production proof | REQUIRES_CHECK |
| `WebmasterDailyMetric.date`, `WebmasterQueryDailyMetric.date`, `MetrikaDailyMetric.date`, `LandingPageDailyMetric.date`, `MetrikaDeviceDailyMetric.date`, `MetrikaGoalDailyMetric.date` | provider civil day / period key | provider date plus site/provider timezone; persisted as `YYYY-MM-DDT00:00:00.000Z` solely for stable storage | сохранить `timestamp(3)`; `timestamptz` запрещён без отдельного semantic redesign | KEEP_TIMESTAMP |
| `MetrikaSearchEngineDailyMetric.date`, `MetrikaSearchPhraseDailyMetric.date`, `MetrikaGeoDailyMetric.date` | provider civil day / period key | provider date plus site timezone; stable UTC-midnight storage only | сохранить `timestamp(3)` | KEEP_TIMESTAMP |
| `MetrikaSearchEngineDailyMetric.createdAt`, `MetrikaSearchPhraseDailyMetric.createdAt`, `MetrikaGeoDailyMetric.createdAt` | ingestion row audit time | DB `now()`; historical session timezone не доказан | не менять до production proof | REQUIRES_CHECK |
| `WebmasterDailyMetric.createdAt`, `WebmasterQueryDailyMetric.createdAt`, `MetrikaDailyMetric.createdAt`, `LandingPageDailyMetric.createdAt`, `MetrikaDeviceDailyMetric.createdAt`, `MetrikaGoalDailyMetric.createdAt` | ingestion row audit time | DB `now()`; historical session timezone не доказан | не менять до production proof | REQUIRES_CHECK |
| `RankingCapture.capturedAt` | instant получения/владельческого снимка позиции | provider RFC3339 instant или explicit `T00:00:00.000Z`; repository constructs JS `Date` | `timestamptz(3)`, explicit `AT TIME ZONE 'UTC'` | TIMESTAMPTZ_UTC |
| `RankingCapture.createdAt` | capture row creation time | DB `now()`; historical session timezone не доказан | не менять до production proof | REQUIRES_CHECK |
| `CompetitorSnapshot.capturedAt` | Topvisor snapshot instant | worker JS `Date` | `timestamptz(3)` | TIMESTAMPTZ_UTC |
| `CompetitorSnapshot.createdAt`, `Notification.createdAt` | persistence/audit time | DB `now()`; historical session timezone не доказан | не менять до production proof | REQUIRES_CHECK |
| `Notification.occurredAt`, `NotificationRead.readAt` | user-visible event/read instants | worker/action JS `Date` | `timestamptz(3)` | TIMESTAMPTZ_UTC |
| `TechnicalSnapshot.capturedAt` | instant provider fetch represented by snapshot | validated provider `fetchedAt` with offset; repository constructs JS `Date` | `timestamptz(3)`, explicit `AT TIME ZONE 'UTC'` | TIMESTAMPTZ_UTC |
| `TechnicalSnapshot.createdAt` | snapshot row creation time | DB `now()`; historical session timezone не доказан | не менять до production proof | REQUIRES_CHECK |
| `ReportSnapshot.generatedAt` | report compilation instant | worker-generated ISO instant with `Z`; repository constructs JS `Date` | `timestamptz(3)`, explicit `AT TIME ZONE 'UTC'` | TIMESTAMPTZ_UTC |
| `ReportSnapshot.createdAt` | report row creation time | DB `now()`; historical session timezone не доказан | не менять до production proof | REQUIRES_CHECK |
| `AuditEvent.createdAt` | audit marker creation time | DB `now()`; historical session timezone не доказан | не менять до production proof | REQUIRES_CHECK |
| `IdempotencyKey.expiresAt` | idempotency retention deadline | reliability service derives ISO instant from injected JS `Date` | `timestamptz(3)`, explicit `AT TIME ZONE 'UTC'` | TIMESTAMPTZ_UTC |
| `IdempotencyKey.createdAt`, `IdempotencyKey.updatedAt` | idempotency record audit time | DB `now()` / Prisma `@updatedAt`; historical session timezone не доказан | не менять до production proof | REQUIRES_CHECK |
| `OutboxEvent.lockedAt`, `OutboxEvent.processedAt` | lease acquisition and terminal processing instants | repository uses injected ISO instant converted to JS `Date` | `timestamptz(3)`, explicit `AT TIME ZONE 'UTC'` | TIMESTAMPTZ_UTC |
| `OutboxEvent.occurredAt`, `OutboxEvent.availableAt` | business occurrence / earliest dispatch instant | application normally supplies UTC ISO, but DB defaults and migration backfill remain valid writers | не менять до production default/backfill proof | REQUIRES_CHECK |
| `OutboxEvent.createdAt`, `OutboxEvent.updatedAt` | outbox row audit time | DB `now()` / Prisma `@updatedAt`; historical session timezone не доказан | не менять до production proof | REQUIRES_CHECK |
| `JobRun.startedAt`, `JobRun.finishedAt` | queue attempt boundaries | repository uses injected UTC ISO/JS `Date` | `timestamptz(3)`, explicit `AT TIME ZONE 'UTC'` | TIMESTAMPTZ_UTC |
| `JobRun.createdAt` | attempt row creation time | DB `now()`; historical session timezone не доказан | не менять до production proof | REQUIRES_CHECK |
| `RuntimeHeartbeat.startedAt`, `RuntimeHeartbeat.heartbeatAt` | worker identity start and latest heartbeat instants | runtime passes JS `Date`; all arithmetic uses epoch milliseconds | `timestamptz(3)`, explicit `AT TIME ZONE 'UTC'` | TIMESTAMPTZ_UTC |
| `RuntimeHeartbeat.createdAt`, `RuntimeHeartbeat.updatedAt` | heartbeat row audit time | DB `now()` / Prisma `@updatedAt`; historical session timezone не доказан | не менять до production proof | REQUIRES_CHECK |
| `RetentionRun.startedAt`, `RetentionRun.finishedAt` | retention execution boundaries | runtime passes one injected JS `Date` | `timestamptz(3)`, explicit `AT TIME ZONE 'UTC'` | TIMESTAMPTZ_UTC |
| `RetentionRun.createdAt` | retention row creation time | DB `now()`; historical session timezone не доказан | не менять до production proof | REQUIRES_CHECK |

Coverage включает все DateTime-поля текущей Prisma schema, включая onboarding, provider operation, Metrica analytics, competitor и notification records. Ранее подтверждённый backup-copy proof сохраняет epoch/null-shape для старых UTC-полей при production timezone `Etc/UTC`; новые migration-поля получают тип явно.

## Identity и access

### User

Better Auth identity with project `systemRole`, immutable optional `username` и `disabledAt`.

- `username` and `email` are unique;
- `PLATFORM_ADMIN` maps to non-tenant `platform-admin`;
- `SEO_ANALYST` maps to non-tenant project-specific `platform-analyst`;
- client access is created only through `Member.tenantRole`;
- `disabledAt` blocks principal creation;
- schema содержит только текущие identity/session records; удалённые compatibility auth tables и flags не являются частью runtime contract.

### Session, Account, Verification

Better Auth-owned authentication state. Session token, IP and user-agent are not DTO. Organization Plugin compatibility state отсутствует.

### Organization and Member

```text
User/Auth Identity
      ↓
Member (tenantRole)
      ↓
Organization
      ↓
Project
```

- membership is unique by `(organizationId, userId)`;
- `tenantRole` is `ORG_OWNER | ORG_MEMBER | VIEWER`, default `VIEWER`;
- membership removal removes tenant principal scope on the next authorization read.

### PrincipalContext

Not a database record. A server factory creates a discriminated principal from fresh User, deterministically selected Membership and server correlation ID. Platform principals never receive fake `organizationId`; tenant reads use only the selected fresh Membership organization.

## Project registry

### Project

Принадлежит одной `Organization`, ссылается на `ThresholdProfile` и `QueryClusterProfile`.

- `slug` уникален глобально;
- status: `ACTIVE`, `PLANNED`, `DISABLED`;
- `version` — positive optimistic concurrency token, initial value `1`;
- successful status/settings mutation increments `version` exactly once;
- stale expected version rejects the mutation and its AuditEvent in the same transaction;
- physical delete production project не является обычной операцией.

### Tenant ownership

`Project` is the ownership root. Every registry, configuration, query, run, metric and report record stores its own required `organizationId`; it is not inferred from a browser route or a mutable session field.

- direct `organizationId → Organization` foreign keys preserve a valid owner;
- composite foreign keys make the owner agree with every parent relation: Site→Project, configuration/query records→their parent, SourceRun→SyncRun/Site, metrics/technical snapshots→Site/SourceRun, RankingCapture→TrackedQuery/optional SourceRun and ReportSnapshot→Site;
- `SyncRun` has an explicit owner even before a SourceRun exists;
- `pnpm verify:tenant-ownership` is a read-only preflight that emits only check names and counts. Its every count must be zero before the contract migration reaches production.

### Site

Принадлежит одному Project и той же Organization.

- `(projectId, slug)` уникален;
- `(organizationId, projectId)` must reference the same Project ownership;
- хранит display name, URL, timezone и `enabled`;
- владеет provider connections, tracked queries, runs, metrics и reports;
- отключение не удаляет историю.

### ProviderConnection

Одна запись на `(siteId, provider)` для Webmaster, Metrika или Topvisor.

- хранит nonsecret external mapping и validated settings JSON;
- credentials остаются в server environment;
- `enabled=false` запрещает provider call.
- lifecycle status: `PENDING | CONNECTING | CONNECTED | ACTION_REQUIRED | FAILED` с safe status code;
- Metrica становится `CONNECTED` только после подтверждения двух выбранных целей.

### SearchTarget и ProviderOperation

- SearchTarget уникален по site + engine + device + region и задаёт четыре Topvisor targets;
- ProviderOperation хранит цену и durable state платного checker по уникальному operationKey;
- `DISPATCHING`/`ACTION_REQUIRED` не перезапускается автоматически.

## Profiles

### ThresholdProfile

Детерминированные пороги alerts/opportunities. Project ссылается на профиль; изменение влияет на будущую compilation.

### QueryClusterProfile и QueryClusterGroup

Классификация запросов по утверждённым группам. `(profileId, slug)` уникален.

### GoalDefinition и GoalDefinitionSite

Project-level allowlist целей Metrika и optional site scope.

- `(projectId, externalGoalId)` уникален;
- `includeInSeoConversion` определяет участие цели в unique target visits;
- category/direction сохраняют business semantics, а не display-only labels.

### TrackedQuerySet и TrackedQuery

Один set на site. Query уникален по `(trackedQuerySetId, normalizedQuery)`.

- содержит source, baseline label и expected count;
- позиции nullable;
- `enabled=false` сохраняет историю, но исключает query из активного core.

## Project command lifecycle

- Project create/status/settings use canonical Zod input and `PrincipalContext`;
- existing Project ownership and requested `organizationId` are checked inside the transaction;
- Project mutation and safe `AuditEvent` commit atomically;
- Project `slug` and `organizationId` are immutable after creation in this slice;
- status/settings changes require the current `version`;
- no Project command physically deletes a Project or its history.

## Platform Admin command lifecycle

- Platform Admin lists read PostgreSQL through owner module queries with allowlisted search/sort/page and browser-safe DTOs;
- typed Server Actions rebuild fresh `PrincipalContext`; browser state does not authorize mutations;
- every mutable aggregate uses positive `version` with optimistic concurrency;
- resource loaders derive target organization from explicit organization input or validated parent ownership;
- Organization, Member, Site, ProviderConnection, GoalDefinition, TrackedQuerySet, ThresholdProfile and QueryClusterProfile commit mutation + safe `AuditEvent` atomically;
- membership removal is explicit and versioned, not implicit overwrite;
- provider settings contain only nonsecret mapping; sensitive keys are rejected before persistence;
- tracked query replacement disables missing queries instead of deleting history.

## Sync lifecycle

### SyncRun

Один запуск worker:

- trigger: `DAILY`, `MANUAL`, `PREFLIGHT`, `BACKFILL`;
- status: `RUNNING`, `SUCCESS`, `PARTIAL`, `FAILED`;
- `startedAt`, фактический `finishedAt`, число обработанных sites и safe error code.

### SourceRun

Provider execution внутри SyncRun и Site.

- status сохраняет `SUCCESS`, `PARTIAL`, `FAILED`, `NOT_CONFIGURED`, `ACCESS_DENIED`, `QUOTA_LIMITED`, `STALE`;
- `durationMs`, row count и safe error metadata не содержат raw response body;
- unexpected worker error закрывает оставшиеся open runs как failed.

PostgreSQL advisory lock запрещает concurrent full sync. Lock session-scoped и освобождается в `finally` или PostgreSQL при разрыве соединения.

## Historical metrics

### Webmaster

- `WebmasterDailyMetric` — daily all-query shows/clicks/CTR/average position, unique `(siteId, date)`;
- `WebmasterQueryDailyMetric` — period/query/device/order detail с demand и relevant URL из Query Analytics, unique по site + period + date + normalized query + device + order;
- total KPI не вычисляется суммой ограниченного popular-query pool.

### Metrika

- `MetrikaDailyMetric` — daily organic/all-traffic and target metrics, unique `(siteId, date)`;
- `LandingPageDailyMetric` — period landing aggregates;
- `MetrikaDeviceDailyMetric` — period device aggregates;
- `MetrikaGoalDailyMetric` — period goal aggregates.
- `MetrikaSearchEngineDailyMetric` — Яндекс/Google organic и unique target visits;
- `MetrikaSearchPhraseDailyMetric` — распознанные и неизвестные поисковые фразы;
- `MetrikaGeoDailyMetric` — география органического трафика.

Upsert обновляет актуальное значение того же natural key и связывает его с последним SourceRun.

### RankingCapture

Exact/owner position на момент `capturedAt`, unique по tracked query + instant + source + engine + device + region. Legacy rows читаются как Яндекс/desktop/legacy.

### CompetitorSnapshot

До 10 ведущих доменов на каждый engine/device/region capture с visibility, average position и Top‑3/10/30/50/100.

### TechnicalSnapshot

Validated JSONB для сложных technical structures Webmaster/Metrika. Raw HTTP body, authorization header и credentials не сохраняются.

## ReportSnapshot

Materialized validated report:

- `siteId`, `periodKey`, `schemaVersion`, `generatedAt`, `freshness`;
- `payload` соответствует `SiteReportSnapshot`;
- records append-only; `ReportRepository` выбирает последний по `generatedAt`;
- report payload — browser DTO, не raw source of truth.

Periods:

| Key | Длина | UI |
|---|---:|---|
| `week` | 7 дней | Неделя |
| `month` | 28 дней | Месяц |
| `quarter` | 90 дней | 3 месяца |
| `halfYear` | 180 дней | Полгода |

`month` — default. Previous period непосредственно предшествует current и имеет ту же длину.

## Metric invariants

- `partial` не становится `success`;
- `stale` не становится `current`;
- неизвестное значение не становится `0`;
- technical endpoint failure сохраняется в partial/error metadata;
- source error одного периода не переносится в успешный другой период;
- Webmaster average position — средняя позиция показов, не exact rank;
- Top-3 является подмножеством Top-10;
- меньшая позиция лучше;
- ranking denominator — всё утверждённое ядро, включая unmeasured queries;
- director conversion = unique target visits / Yandex organic visits;
- direct query-to-lead attribution запрещена;
- данные разных projects/sites/periods не смешиваются.

## Reliability records

### Notification и NotificationRead

Notification — safe пользовательская проекция lifecycle-события с tenant scope, visibility и уникальным dedupKey. NotificationRead индивидуален пользователю и уникален по `(notificationId, userId)`; технические журналы не заменяет.

### AuditEvent

Safe append-only marker: optional organization, actor type/id, action, entity, before/after markers, source, correlation ID and timestamp. Organization deletion sets relation null without deleting platform audit history.

### IdempotencyKey

Unique `(scope, organizationScope, key)`. Stores SHA-256 request hash, lifecycle status, response marker, expiry and optional OutboxEvent link. `organizationScope` is always explicit: organization ID or `platform`.

### OutboxEvent

Status `PENDING → PROCESSING → PROCESSED` or `DEAD_LETTER`; stores topic, JSON payload, `schemaVersion`, `occurredAt`, attempts, availability, lease owner/time, safe error, correlation and processed timestamp.

### JobRun

One row per attempt, unique `(outboxEventId, attempt)`. Stores worker, RUNNING/SUCCESS/FAILED, timing and safe error code.

### RuntimeHeartbeat

One row per unique `(runtime, workerId)`. `startedAt` records the first observed start for that identity; `heartbeatAt` is refreshed at most once per minute and is the only worker-liveness source used by readiness.

### RetentionRun

Retention execution marker: RUNNING/SUCCESS/FAILED, started/finished timestamps and deleted outbox/job-run counts.

Invariants:

- enqueue transaction atomically creates idempotency marker, event and audit;
- same key + same hash returns the original event;
- same key + different hash is rejected;
- pg-boss transports claimed outbox work, but business retry/dead-letter truth remains in OutboxEvent and JobRun;
- queue payload carries a wrapper `schemaVersion` and one authoritative claimed event in `job.data.event`;
- queue dispatch uses `singletonKey = outboxEventId`; a duplicate/null send is not a business failure;
- only lease owner completes/fails;
- retry uses bounded exponential backoff;
- permanent/exhausted failures become dead-letter;
- retention removes only old processed/dead-letter outbox detail;
- payload/audit/error fields never contain secrets or raw PII.

## Delete и retention

- auth child records cascade вместе с User/Organization по schema rules;
- Project/Site core relations используют `Restrict` там, где удаление потеряло бы business history;
- physical delete project/site/history требует отдельной destructive operation и backup/rollback plan;
- ReportSnapshot и historical retention автоматически не удаляются текущим application code;
- release rollback не откатывает PostgreSQL schema/data автоматически.

## Backup

Production contract: local custom-format `pg_dump`, checksum, обязательная private offsite copy с HEAD confirmation, retention tiers и restore smoke во временную БД. Детали: `docs/DATABASE.md` и `docs/ops/RECOVERY.md`.
