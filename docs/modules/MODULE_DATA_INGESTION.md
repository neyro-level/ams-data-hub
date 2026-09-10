# Module: Data Ingestion

## Назначение

Собирает provider evidence, безопасно настраивает Topvisor и сохраняет tenant-owned history in PostgreSQL.

## Не входит в scope

Browser provider calls, Яндекс mutations, произвольные Topvisor operations вне allowlist, credential storage, report presentation and arbitrary scheduler logic.

## Data ownership

SyncRun, SourceRun, ProviderOperation, historical metrics, CompetitorSnapshot, TechnicalSnapshot and ingestion repository contracts. Reporting owns ReportSnapshot semantics; Project Registry owns configuration/SearchTarget. A dedicated Monday timer starts the paid Topvisor checker before the daily collector; a successful ranking capture completes the durable operation.

## Principal types

`job` for outbox-triggered sync; operator/system command for scheduled/manual sync. Browser principals do not call provider adapters.

## Roles and permissions

SEO_ANALYST may request allowed sync through server capabilities; client roles cannot operate ingestion.

## Commands

Compiled worker commands: project sync, competitors sync and provider preflight/audit wrappers. Deferred handlers: `project.sync.requested`, `site.integrations.setup.requested`, `site.competitors.sync.requested`.

## Queries

Loads enabled project/site/provider configuration through Project Registry worker APIs and reads previous normalized evidence as needed.

## DTO

Provider responses are normalized and validated before persistence. Raw HTTP body, token/header and secret settings are never DTO.

## Invariants

- provider access uses exact-origin HTTPS; Яндекс read-only, Topvisor bounded by explicit allowlist;
- price-check and durable operation reservation precede every paid Topvisor launch;
- browser and web env have no provider tokens;
- one source/period failure does not contaminate another;
- `partial`, `stale` and null stay honest;
- only included goals form unique-target conversion;
- concurrent full sync is blocked by PostgreSQL advisory lock;
- unexpected failure closes open runs.

## Tenant behavior

Every run/metric/snapshot write carries explicit organizationId and matching parent ownership; database constraints reject cross-tenant relations.

## Resource authorization

JobPrincipal organization must match loaded Project/Site. Operator commands use server configuration, never browser-selected tenant authority.

## State lifecycle

SyncRun: RUNNING → SUCCESS/PARTIAL/FAILED. SourceRun preserves exact provider status and factual timestamps.

## Concurrency

Session-scoped advisory lock prevents overlapping full sync; natural keys protect metric upserts.

## Idempotency

Deferred sync uses Platform Operations idempotency/outbox. Metric upserts use natural keys; snapshots append.

## Audit

Sync request enqueue is audited. Execution evidence lives in SyncRun/SourceRun and redacted structured logs.

## Events / Async policy

`project.sync.requested`, `site.integrations.setup.requested` and `site.competitors.sync.requested` travel OutboxEvent → pg-boss → idempotent JobPrincipal handlers outside the enqueue transaction.

## Integrations

Yandex Webmaster, Yandex Metrika and Topvisor via `collector/sources/*`. Daily Yandex, Monday positions, onboarding + first-Monday monthly competitors.

## Failure behavior

Overlap → SYNC_ALREADY_RUNNING; access/quota/endpoint failures preserve safe source status; failed final run returns nonzero process exit.

## Tests

Provider mappings, period isolation, goal semantics, real-PostgreSQL persistence, tenant ownership, lock overlap/release and failure finalization.
