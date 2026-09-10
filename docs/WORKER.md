# WORKER

## Назначение

Worker runtime имеет два режима: постоянный outbox daemon и отдельные compiled oneshot commands для provider sync/retention. Он не обслуживает browser requests.

Entry points:

- command source: `src/worker/main.ts`;
- daemon wrapper: `scripts/worker-daemon.mjs`;
- orchestration: `src/modules/data-ingestion/worker.ts`, `src/modules/data-ingestion/index.ts`;
- composition: `src/infrastructure/worker-service-container.ts`;
- compiled: `dist-collector/src/worker/main.js`.

## Runtime flow

```text
systemd timer / operator command / outbox handler
→ acquire PostgreSQL advisory full-sync lock
→ load project/site/provider config from PostgreSQL
→ create SyncRun + SourceRuns
→ call read-only Yandex adapters or bounded Topvisor onboarding/checker API
→ normalize DTOs
→ calculate equal periods and comparisons
→ compile SiteReportSnapshot
→ persist history + technical/ranking data + ReportSnapshot
→ close SourceRuns and SyncRun
→ structured safe log
→ release lock and exit
```

## Provider policy

- Webmaster: verified host, summary, query history/detail and technical endpoints;
- Metrika: Яндекс/Google organic, counter/goals, traffic, phrases, geography, landing/device/goal data and unique target visits;
- Topvisor: project discovery/create, four search targets, core import, price-check, positions and competitors;
- browser never calls providers;
- browser mutations prohibited; Topvisor writes выполняет только idempotent worker после durable operation reservation;
- HTTP/token/raw sensitive bodies not persisted or logged.

Topvisor считается готовым после четырёх search targets, импорта 20–100 запросов, доступного price-check и запуска первого съёма. `DISPATCHING` после неоднозначного ответа автоматически не повторяется. Пустой history не превращается в нулевые позиции.

## Period contract

| Key | Days |
|---|---:|
| `week` | 7 |
| `month` | 28 |
| `quarter` | 90 |
| `halfYear` | 180 |

- `month` default;
- previous period immediately precedes current and has equal length;
- period end is based on factual Webmaster range, last report comparison or current date fallback;
- error state is local to its period and must not contaminate later successful periods;
- baseline technical endpoint errors are merged into that period as `partial`.

## Goal semantics

- all site-scoped allowed goals may remain in detail and cumulative goal actions;
- only `includeInSeoConversion=true` goal IDs form the unique-target OR filter;
- unique target visits count a visit once even if several included goals were reached;
- director conversion = unique target visits / Yandex organic visits.

## Persistence

Worker writes:

- `SyncRun`, `SourceRun` with organization/project/correlation stats;
- pg-boss jobs in schema `pgboss`;
- `RankingCapture`;
- `SearchTarget`, `ProviderOperation`, `CompetitorSnapshot`;
- Metrica engine/phrase/geo metrics и Webmaster demand/relevant URL;
- пользовательские `Notification` projections;
- `TechnicalSnapshot`;
- append-only `ReportSnapshot`;
- one throttled `RuntimeHeartbeat` row per runtime/worker identity;
- retention markers in `RetentionRun`.

Upserts use natural unique keys. Snapshot `generatedAt` is stable for one sync; run `finishedAt` is captured at actual completion. Worker runtime emits redacted pino JSON logs with correlation-aware fields.

## Outbox lifecycle

- persistent Compose service `worker` polls outbox через `scripts/worker-daemon.mjs` (default delay 5 seconds);
- one drain handles at most 25 events;
- business transaction creates `OutboxEvent` only in PostgreSQL;
- each drain first processes already queued jobs, then claims and publishes new outbox events without an immediate fetch-after-send;
- a successful `send()` is dispatch success; `null` means an idempotent duplicate and is not a failure;
- every published job uses `singletonKey = outboxEventId`; handler input comes only from `job.data.event`;
- pg-boss runtime starts with `migrate:false` and `createSchema:false`; schema install is a reviewed migration step, not worker behavior;
- handler recreates JobPrincipal from the queued event and validates expected organization scope before sync;
- `seo-monitor-outbox.timer` is a daily retention timer, not the outbox drain transport;
- complete/fail still update `OutboxEvent` and `JobRun`, so retry/dead-letter truth remains in app tables;
- retry base 30 seconds, exponential, capped at one hour and five attempts;
- invalid payload/unknown topic goes directly to dead-letter;
- the persistent daemon records its own heartbeat at most once per minute, including idle polls;
- readiness reads that heartbeat only; sync and retention timestamps do not impersonate worker liveness;
- readiness exposes pending/processing/dead-letter counts plus worker heartbeat and integration freshness.

## Failure behavior

- overlapping full sync → `SYNC_ALREADY_RUNNING`;
- partial provider endpoint → partial source/report with safe errors;
- total provider failure may use previous report section for display, but source status remains failure/stale rather than success;
- one site/provider error contributes to safe project status;
- unexpected exception best-effort closes every open SourceRun and SyncRun as failed;
- final project status `failed` sets nonzero process exit for systemd; `partial` remains an observable successful process with partial result;
- lock release is guaranteed in `finally`/connection close.

## Commands

```bash
pnpm build:collector
pnpm worker:sync:project -- <project-slug>
pnpm worker:sync:all
pnpm worker:topvisor:checks
pnpm worker:sync:competitors
pnpm worker:outbox:drain
pnpm worker:outbox:retention
```

Commands require a safe DB environment and provider secrets. The scheduled `topvisor-checks` command runs on Monday before `projects-sync`, obtains the checker price, reserves a unique `ProviderOperation`, and only then starts the paid rank check. The scheduled `projects-sync` command reads all active project slugs from PostgreSQL; no client slug is embedded in the release artifact.

## Проверки

- pure period/query/report tests;
- provider 401/403/420/429/5xx handling;
- partial technical metadata propagation;
- goal inclusion in unique conversion;
- SyncRun/SourceRun actual timestamps;
- DB integration persistence;
- unexpected failure finalization;
- advisory lock overlap/release;
- outbox idempotency/hash reuse;
- lease ownership and stale claim;
- retry/backoff/dead-letter;
- JobRun attempt history;
- compiled worker smoke without web-only imports.

DB-backed suites require isolated `TEST_DATABASE_*`; skipped suites are not evidence of DB behavior.
