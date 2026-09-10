# SITE REPORT IA

## Route

```text
/c/{clientSlug}/{siteSlug}/?period=week|month|quarter|halfYear
```

Один site = один единый director report без tab-based fragmentation. `month` — default при отсутствующем/невалидном query parameter.

## Access

1. Better Auth session;
2. active user;
3. analyst global scope или client organization membership;
4. scoped project/site lookup;
5. latest `ReportSnapshot` по site + period;
6. validated `SiteReportSnapshot` в presentation.

Unauthenticated route redirect: `/?login=1`. Foreign tenant получает not-found/denial. Navigation не является authorization.

## Hierarchy

```text
/dashboard/
→ /analyst/ (SEO_ANALYST)
→ /c/{clientSlug}/
→ /c/{clientSlug}/{siteSlug}/
```

## Report order

1. Page header: project/site, URL, period control, timezone and freshness/source context.
2. Ranking: Top-3/Top-10, coverage, movement and tracked queries.
3. Technical/Webmaster health: diagnostics, indexing, SQI and search events.
4. Search demand: shows, clicks, CTR, average show position and comparison.
5. Metrika: organic visits, unique target visits, goal actions and conversion.
6. Landing pages/devices/goals.
7. Combined alerts, risks, opportunities and methodology.

Ranking stays above Webmaster/Metrika detail. Webmaster average show position is not displayed as exact rank.

## State rules

- `fresh` — required enabled sources succeeded for the report period;
- `partial` — usable data exists, but source/technical endpoint is incomplete;
- `stale`/LKG section — previous data may be displayed only with explicit source state;
- `unavailable` — no usable current/previous report section;
- `null` renders unknown/unavailable, not zero;
- source, period, timezone, baseline and safe error labels remain visible.

## Period control

`ReportPeriodSelector` changes the route query. Server renders the selected period from PostgreSQL; browser does not fetch provider APIs or `/data/latest.json`.

## Responsive contract

Required widths: `375`, `768`, `1280`, `1440`.

- no whole-page horizontal overflow;
- tables may scroll only inside their local container;
- mobile uses drawer/touch-friendly controls;
- desktop keeps full application shell;
- long Russian labels, URLs and query text wrap or truncate intentionally;
- charts remain readable and do not hide source/state context.

Visual tokens/components are defined in `docs/INTERNAL_DASHBOARD_DESIGN_SYSTEM.md`.
