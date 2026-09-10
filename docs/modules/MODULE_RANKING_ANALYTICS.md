# Module: Ranking Analytics

## Назначение

Вычисляет позиции утверждённого ядра, доли Top-3/Top-10 и movement tracked queries.

## Не входит в scope

Webmaster average position as exact rank, browser provider calls, arbitrary provider mutations and cross-site aggregate rank.

## Data ownership

Domain query merge/calculations in `src/modules/ranking-analytics`; TrackedQuery/RankingCapture persistence belongs to Project Registry/Data Ingestion schema paths.

## Principal types

No principal handling inside pure domain functions. Access is enforced by the calling Reporting/Project Registry use case.

## Roles and permissions

Inherited from the owner query: analyst global read or tenant report/project read.

## Commands

None. This module is deterministic read/calculation logic.

## Queries

Merge approved tracked queries with exact Topvisor or labelled owner-provided positions.

## DTO

Uses browser-safe ranking parts of `SiteReportSnapshot`; credentials and transport details are excluded.

## Invariants

- denominator includes the full enabled approved query set;
- Top-3 is a subset of Top-10;
- lower numeric position is better;
- improvement: current < previous; decline: current > previous;
- new/lost requires exact previous capture;
- nullable owner baseline does not become new/lost;
- source, baseline/capture label and measured count remain visible.

## Tenant behavior

Calculations receive one already-authorized Site dataset. Cross-site or cross-tenant inputs are not combined.

## Resource authorization

Owned by the caller; this pure module never resolves routes, sessions or organization IDs.

## State lifecycle

Tracked query `enabled=false` excludes it from active denominator while stored captures remain history.

## Concurrency

Pure calculations are deterministic for one input snapshot. Capture persistence uniqueness is enforced by database keys.

## Idempotency

Same normalized input produces the same output; no side effects.

## Audit

None for calculation. Query-set mutations are audited by Project Registry.

## Events / Async policy

No topics or jobs owned.

## Integrations

Topvisor provides exact captures for Яндекс/Google × desktop/mobile through Data Ingestion. Project/search-target/core setup and paid checker are permitted only inside the idempotent worker contract; owner-provided fallback remains labelled.

## Failure behavior

Missing position stays null/unmeasured. Provider absence never becomes position zero.

## Tests

Normalization/uniqueness, denominator, Top-3/Top-10, movement semantics, source labelling and browser-safe serialization.
