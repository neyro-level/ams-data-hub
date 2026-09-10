# Module: Reporting

## Назначение

Компилирует и выдаёт единый browser-safe директорский SEO-отчёт сайта по четырём периодам и пяти вкладкам.

## Не входит в scope

Provider HTTP, tenant configuration, report mutations from browser, второй compiler и raw provider UI.

## Data ownership

ReportSnapshot persistence, report repository port, period semantics and `SiteReportSnapshot` compilation.

## Principal types

`platform-analyst` and `tenant-user` through `PrincipalContext` only.

## Roles and permissions

Platform analyst reads allowed reports globally. Tenant user reads only reports inside fresh Membership organization.

## Commands

No browser business mutations. Snapshot persistence is invoked from Data Ingestion worker orchestration.

## Queries

`ReportService.getSiteReportForUser` читает latest snapshot; `getSiteDirectorAnalyticsForUser` после того же tenant authorization читает engine/phrase/geo/demand/competitor projections.

## DTO

`SiteReportSnapshot` v2 — основной browser contract; v1 читается compatibility schema. Дополнительная `DirectorAnalytics` projection содержит только нормализованные агрегаты, без raw provider payload.

## Invariants

- compiler only at `src/modules/reporting/domain/report-compiler.ts`;
- `week=7`, `month=28`, `quarter=90`, `halfYear=180`; default month;
- current and previous periods have equal length;
- `partial`, `stale`, `unavailable` and `null` remain explicit;
- Webmaster average show position is not exact ranking;
- Top-3 is a subset of Top-10;
- direct query-to-lead attribution is prohibited;
- sites and periods are never mixed.
- вкладки: overview, queries/ranks, pages/leads, technical, competitors;
- Яндекс default, Google и desktop/mobile остаются явными измерениями;
- Webmaster → Metrica funnel всегда помечена сводкой разных источников.

## Tenant behavior

ReportSnapshot carries organizationId and Site ownership; route slugs never establish scope.

## Resource authorization

Report query validates Project/Site access before loading the latest snapshot. Foreign tenant receives denial/not-found.

## State lifecycle

Validated snapshots are append-only. Repository selects latest by `generatedAt`; old data may be shown only with explicit stale/partial status.

## Concurrency

One sync uses a stable generatedAt. Concurrent full sync is prevented by Data Ingestion advisory lock.

## Idempotency

Natural snapshot identity and worker orchestration prevent accidental cross-period overwrite; repeated reads are side-effect free.

## Audit

Reads do not create business AuditEvent. Snapshot-producing sync is tracked by SyncRun/SourceRun and worker logs.

## Events / Async policy

Reporting does not own outbox topics. It is called by the idempotent project sync handler.

## Integrations

Consumes normalized data through application contracts; never calls Yandex/Topvisor directly.

## Failure behavior

Missing/invalid snapshot → unavailable/not-found; foreign scope → denial; previous data requires explicit source/freshness label.

## Tests

Period math, compiler semantics, authorization, schema serialization, latest snapshot selection and responsive report route.
