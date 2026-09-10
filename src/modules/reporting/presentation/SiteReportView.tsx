import type { ReactNode } from "react";
import { MetricTrendChart } from "../../../components/charts/MetricTrendChart.tsx";
import { RankingShareChart } from "../../../components/charts/RankingShareChart.tsx";
import { KpiCard } from "../../../components/dashboard/KpiCard.tsx";
import { PageHeader } from "../../../components/dashboard/PageHeader.tsx";
import { SectionCard } from "../../../components/dashboard/SectionCard.tsx";
import { StatusBanner } from "../../../components/dashboard/StatusBanner.tsx";
import { StatePanel } from "../../../components/states/StatePanel.tsx";
import { DataTable } from "../../../components/tables/DataTable.tsx";
import { TrackedQueryTable } from "../../../components/tables/TrackedQueryTable.tsx";
import { formatDuration, formatInteger, formatPercent, formatPosition } from "../../../shared/format/metrics.ts";
import type { ReportComparison, SiteReportSnapshot } from "../../../shared/schemas/report.ts";
import type { SiteRegistry } from "../../../shared/schemas/registry.ts";
import type { DirectorAnalytics } from "../application/ports/report-repository.ts";
import { DirectorReportTabs } from "./DirectorReportTabs.tsx";

type ComparisonMetric = ReportComparison["metrics"]["shows"];

function formatDelta(metric: ComparisonMetric | undefined, mode: "percent" | "points" | "position" = "percent") {
  const value = mode === "percent" ? metric?.deltaPercent : metric?.deltaPoints;
  if (value === null || value === undefined) return { text: undefined, tone: "neutral" as const };
  if (mode === "position") {
    return {
      text: value > 0 ? `Улучшение на ${Math.abs(value).toFixed(1)}` : value < 0 ? `Ухудшение на ${Math.abs(value).toFixed(1)}` : "Без изменений",
      tone: value > 0 ? ("positive" as const) : value < 0 ? ("negative" as const) : ("neutral" as const),
    };
  }
  const formatted = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1, signDisplay: "exceptZero" }).format(value);
  return {
    text: mode === "points" ? `${formatted} п.п.` : `${formatted}%`,
    tone: value > 0 ? ("positive" as const) : value < 0 ? ("negative" as const) : ("neutral" as const),
  };
}

function factCard(label: string, value: string, note?: string) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)] p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-app-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-app-foreground">{value}</p>
      {note ? <p className="mt-1 text-xs text-app-secondary">{note}</p> : null}
    </div>
  );
}

function countDelta(value: number | null, label: string) {
  if (value === null) return "Нет сравнения";
  if (value === 0) return `Без изменений ${label}`;
  return `${value > 0 ? "+" : ""}${value} ${label}`;
}

function readableInsight(value: string) {
  return value
    .replace(/Критичное техническое состояние/giu, "Сайт требует внимания")
    .replace(/HTTP 5xx/giu, "Ошибок сервера")
    .replace(/критичных диагностик/giu, "серьёзных проблем")
    .replace(/ошибок Sitemap/giu, "ошибок карты сайта")
    .replace(/\bCTR\b/giu, "кликабельность");
}

type SiteReportViewProps = {
  site: SiteRegistry;
  snapshot: SiteReportSnapshot | null;
  mode: "fixture" | "live";
  backHref?: string;
  periodControl?: ReactNode;
  directorAnalytics?: DirectorAnalytics | null;
};

export function SiteReportView({ site, snapshot, mode, backHref, periodControl, directorAnalytics = null }: SiteReportViewProps) {
  if (!snapshot) {
    const sourcesEnabled = site.webmaster.enabled || site.metrica.enabled;
    return (
      <div className="space-y-6">
        <PageHeader title={site.name} description="Единый отчёт по поисковой видимости, техническому состоянию и органическому трафику." backHref={backHref} />
        {periodControl}
        <StatePanel state={sourcesEnabled ? "stale" : "not-connected"} title={sourcesEnabled ? "Отчёт готовится" : "Источники не подключены"} description={sourcesEnabled ? "Данные появятся после завершения обновления." : "Для отчёта нужны доступы к Яндекс.Вебмастеру и Яндекс.Метрике."} />
      </div>
    );
  }

  const webmaster = snapshot.webmaster;
  const metrica = snapshot.metrica;
  const ranking = snapshot.ranking;
  const health = webmaster?.health ?? null;
  const comparison = snapshot.comparison?.metrics;
  const periodStart = snapshot.sources.webmaster.periodStart ?? snapshot.sources.metrica.periodStart;
  const periodEnd = snapshot.sources.webmaster.periodEnd ?? snapshot.sources.metrica.periodEnd;
  const periodLabel = periodStart && periodEnd ? `${periodStart} — ${periodEnd}` : "период источника";
  const showsDelta = formatDelta(comparison?.shows);
  const clicksDelta = formatDelta(comparison?.clicks);
  const ctrDelta = formatDelta(comparison?.ctr, "points");
  const positionDelta = formatDelta(comparison?.avgPosition, "position");
  const visitsDelta = formatDelta(comparison?.organicVisits);
  const targetsDelta = formatDelta(comparison?.targetVisits);
  const conversionDelta = formatDelta(comparison?.conversionRate, "points");
  const topAlert = snapshot.combined.alerts[0] ?? null;
  const topOpportunity = snapshot.combined.opportunities[0] ?? null;
  const healthTone = health?.status === "critical" ? "error" : health?.status === "attention" ? "warning" : "success";
  const healthTitle = health?.status === "critical" ? "Есть критичные проблемы" : health?.status === "attention" ? "Сайт требует внимания" : "Сайт работает стабильно";
  const integrationErrors = Object.entries(snapshot.sources)
    .filter((entry): entry is [string, NonNullable<(typeof snapshot.sources)[keyof typeof snapshot.sources]>] => Boolean(entry[1]))
    .filter(([, source]) => ["failed", "access_denied", "quota_limited"].includes(source.status));

  return (
    <div className="w-[calc(100vw-2rem)] min-w-0 max-w-full space-y-8 sm:w-[calc(100vw-3rem)] lg:w-auto">
      <PageHeader title={site.name} description={`Единый отчёт за ${periodLabel}. Обновлён ${new Date(snapshot.generatedAt).toLocaleString("ru-RU")}.`} backHref={backHref} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        {periodControl}
        <p className="text-xs text-app-muted-foreground">{mode === "live" ? "Актуальные данные" : "Демонстрационные данные"}</p>
      </div>
      <DirectorReportTabs snapshot={snapshot} analytics={directorAnalytics} timezone={site.timezone} />

      {snapshot.freshness === "partial" ? <StatusBanner tone="warning" title="Отчёт собран частично" description="Часть источников не вернула полный набор данных. Доступные показатели показаны без подмены отсутствующих значений нулями." /> : null}
      {snapshot.freshness === "stale" ? <StatusBanner tone="warning" title="Данные устарели" description="Последний отчёт старше допустимого периода. Показатели сохранены для сравнения, но не считаются текущими." /> : null}
      {snapshot.freshness === "unavailable" ? <StatusBanner tone="error" title="Отчёт временно недоступен" description="Ни один обязательный источник не предоставил актуальные данные." /> : null}
      {integrationErrors.length > 0 ? <StatusBanner tone="error" title="Не удалось обновить часть данных" description="Проверьте доступ к подключённым источникам и повторите обновление." /> : null}

      <div className="hidden" aria-hidden="true">
      {ranking ? (
        <section className="space-y-4" aria-labelledby="ranking-title">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-app-primary">Поисковые запросы</p>
              <h2 id="ranking-title" className="mt-1 text-2xl font-semibold text-app-foreground">Позиции утверждённых запросов</h2>
            </div>
            <p className="text-xs text-app-muted-foreground">
              {ranking.source === "topvisor" && ranking.lastCapturedAt
                ? `Последний съём Topvisor: ${ranking.lastCapturedAt}`
                : `Первый замер · сравнение с ${ranking.baselineLabel}`}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Поисковые запросы"
              value={formatInteger(ranking.queryCount)}
              delta={`${ranking.measuredCount} с текущей позицией`}
              deltaTone="neutral"
            />
            <KpiCard
              label="Запросы в Топ-10"
              value={`${ranking.top10Count} из ${ranking.queryCount}`}
              tone="primary"
              delta={`${formatPercent(ranking.top10Share)} · ${countDelta(ranking.top10Delta, "к началу периода")}`}
              deltaTone={(ranking.top10Delta ?? 0) > 0 ? "positive" : (ranking.top10Delta ?? 0) < 0 ? "negative" : "neutral"}
            />
            <KpiCard
              label="Запросы в Топ-3"
              value={`${ranking.top3Count} из ${ranking.queryCount}`}
              tone="soft"
              delta={`${formatPercent(ranking.top3Share)} · ${countDelta(ranking.top3Delta, "к началу периода")}`}
              deltaTone={(ranking.top3Delta ?? 0) > 0 ? "positive" : (ranking.top3Delta ?? 0) < 0 ? "negative" : "neutral"}
            />
            <KpiCard
              label="Изменение позиций"
              value={`+${ranking.improvedCount} / −${ranking.declinedCount}`}
              delta={`Новые ${ranking.newCount} · потеряны ${ranking.lostCount}`}
              deltaTone={ranking.improvedCount > ranking.declinedCount ? "positive" : ranking.declinedCount > ranking.improvedCount ? "negative" : "neutral"}
            />
          </div>
          <RankingShareChart ranking={ranking} timezone={site.timezone} />
          <SectionCard title="Поисковые запросы" note={`${ranking.measuredCount} из ${ranking.queryCount} с текущей позицией`}>
            <TrackedQueryTable ranking={ranking} />
          </SectionCard>
        </section>
      ) : null}

      {health ? (
        <section className="space-y-4" aria-labelledby="health-title">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-app-primary">Состояние сайта</p>
            <h2 id="health-title" className="max-w-full break-words text-2xl font-semibold text-app-foreground">Индексация и техническое здоровье</h2>
          </div>
          <StatusBanner tone={healthTone} title={healthTitle} description={`${health.fatalCount + health.criticalCount} критичных проблем, ${health.possibleProblemCount} возможных проблем; ошибок сервера: ${health.http5xx}; ошибок карты сайта: ${health.sitemapErrors}.`} />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {factCard("Страницы в поиске", formatInteger(health.pagesInSearch), `${formatInteger(health.excludedPages)} исключено`)}
            {factCard("Карта сайта", formatInteger(health.sitemapUrls), health.sitemapErrors > 0 ? `${health.sitemapErrors} ошибок` : "без ошибок")}
            {factCard("Обновление поиска", health.searchBalance >= 0 ? `+${formatInteger(health.searchBalance)}` : formatInteger(health.searchBalance), `${health.appearedInSearch} появилось · ${health.removedFromSearch} удалено`)}
            {factCard("Индекс качества сайта", formatInteger(health.sqi), health.sqiDelta === null ? "нет сравнения" : `${health.sqiDelta > 0 ? "+" : ""}${health.sqiDelta} к прошлому замеру`)}
          </div>
        </section>
      ) : null}

      <section className="space-y-4" aria-labelledby="seo-title">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-app-primary">Результат продвижения</p>
          <h2 id="seo-title" className="mt-1 text-2xl font-semibold text-app-foreground">Видимость в поиске Яндекса</h2>
        </div>
        {webmaster ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="Показы" value={formatInteger(webmaster.summary.shows)} tone="primary" delta={showsDelta.text} deltaTone={showsDelta.tone} />
              <KpiCard label="Клики" value={formatInteger(webmaster.summary.clicks)} delta={clicksDelta.text} deltaTone={clicksDelta.tone} />
              <KpiCard label="Кликабельность" value={formatPercent(webmaster.summary.ctr, 2)} delta={ctrDelta.text} deltaTone={ctrDelta.tone} />
              <KpiCard label="Средняя позиция" value={formatPosition(webmaster.summary.avgPosition)} delta={positionDelta.text} deltaTone={positionDelta.tone} />
            </div>
            <MetricTrendChart title="Динамика показов и кликов" subtitle="Как меняется поисковая видимость сайта по дням." period={periodLabel} timezone={site.timezone} data={webmaster.visibilityTrend} metricLabel="Показы" secondaryMetricLabel="Клики" tertiaryMetricLabel="Средняя позиция" />
          </>
        ) : <StatePanel state="empty" title="Нет данных Вебмастера" description="Источник не подключён или временно недоступен." />}
      </section>

      <section className="space-y-4" aria-labelledby="traffic-title">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-app-primary">Трафик</p>
          <h2 id="traffic-title" className="mt-1 text-2xl font-semibold text-app-foreground">Органические визиты и целевые действия</h2>
        </div>
        {metrica ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="Органические визиты" value={formatInteger(metrica.summary.visits)} tone="primary" delta={visitsDelta.text} deltaTone={visitsDelta.tone} />
              <KpiCard label="Целевые визиты" value={formatInteger(metrica.summary.targetVisits)} tone="soft" delta={targetsDelta.text} deltaTone={targetsDelta.tone} />
              <KpiCard label="Конверсия" value={formatPercent(metrica.summary.conversionRate)} tone="success" delta={conversionDelta.text} deltaTone={conversionDelta.tone} />
              <KpiCard label="Среднее время" value={formatDuration(metrica.summary.averageVisitDurationSeconds)} />
            </div>
            <MetricTrendChart title="Органический трафик" subtitle="Как меняются визиты и целевые действия из поиска Яндекса." period={periodLabel} timezone={site.timezone} data={metrica.organicTrend} metricLabel="Визиты" secondaryMetricLabel="Целевые визиты" tertiaryMetricLabel="Конверсия" />
            <SectionCard title="Посадочные страницы" note="Основные входы из органического поиска">
              <DataTable caption="Эффективность посадочных страниц" columns={["Страница", "Визиты", "Целевые визиты", "Конверсия", "Отказы"]} rows={metrica.landingPages.slice(0, 10).map((page) => ({ key: page.path, cells: [<span key="path" className="font-semibold text-app-foreground">{page.path}</span>, formatInteger(page.visits), formatInteger(page.targetVisits), formatPercent(page.conversionRate), formatPercent(page.bounceRate)] }))} />
            </SectionCard>
          </>
        ) : <StatePanel state="empty" title="Нет данных Метрики" description="Источник не подключён или временно недоступен." />}
      </section>
      </div>

      <SectionCard title="Что делать дальше" note="Приоритеты по фактическим данным">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl bg-[var(--muted)] p-4"><p className="text-xs font-semibold uppercase text-app-muted-foreground">Главный риск</p><p className="mt-2 font-semibold">{topAlert ? readableInsight(topAlert.title) : "Критичных рисков не обнаружено"}</p>{topAlert ? <p className="mt-1 text-sm text-app-secondary">{readableInsight(topAlert.summary)}</p> : null}</div>
          <div className="rounded-xl bg-[var(--muted)] p-4"><p className="text-xs font-semibold uppercase text-app-muted-foreground">Точка роста</p><p className="mt-2 font-semibold">{topOpportunity ? readableInsight(topOpportunity.title) : "Сохранить текущий курс"}</p>{topOpportunity ? <p className="mt-1 text-sm text-app-secondary">{readableInsight(topOpportunity.summary)}</p> : null}</div>
        </div>
      </SectionCard>

      <footer className="border-t border-[var(--border)] pt-5 text-xs leading-5 text-app-muted-foreground">
        <p>Источники: Topvisor — точные позиции поисковых запросов; Яндекс.Вебмастер — спрос, страницы в поиске и найденные проблемы; Яндекс.Метрика — обезличенный трафик и целевые действия.</p>
        <p>Вебмастер показывает среднюю позицию за период, а не точную позицию в конкретный день. Клики и визиты считаются разными системами.</p>
      </footer>
    </div>
  );
}
