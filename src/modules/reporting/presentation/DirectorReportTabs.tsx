"use client";

import { useState } from "react";
import { KpiCard } from "../../../components/dashboard/KpiCard.tsx";
import { SectionCard } from "../../../components/dashboard/SectionCard.tsx";
import { StatePanel } from "../../../components/states/StatePanel.tsx";
import { DataTable } from "../../../components/tables/DataTable.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs.tsx";
import { Button } from "../../../components/ui/button.tsx";
import { formatInteger, formatPercent, formatPosition } from "../../../shared/format/metrics.ts";
import type { SiteReportSnapshot } from "../../../shared/schemas/report.ts";
import type { DirectorAnalytics } from "../application/ports/report-repository.ts";

export function DirectorReportTabs({ snapshot, analytics, timezone }: { snapshot: SiteReportSnapshot; analytics: DirectorAnalytics | null; timezone: string }) {
  const webmaster = snapshot.webmaster; const metrica = snapshot.metrica; const ranking = snapshot.ranking;
  const [engine, setEngine] = useState<"YANDEX" | "GOOGLE">("YANDEX");
  const [device, setDevice] = useState<"ALL" | "DESKTOP" | "MOBILE">("ALL");
  const lead = metrica?.goals.find((goal) => goal.category === "lead_submit");
  const phone = metrica?.goals.find((goal) => goal.category === "phone_click");
  const phrases = analytics?.phrases.filter((row) => row.engine === engine) ?? [];
  const webmasterQueries = engine === "YANDEX"
    ? analytics?.webmasterQueries.filter((row) => device === "ALL" || row.device === device) ?? []
    : [];
  const competitors = analytics?.competitors.filter((row) => row.engine === engine && (device === "ALL" || row.device === device)) ?? [];
  const selectors = <div className="flex flex-wrap gap-2" aria-label="Поисковая система и устройство">
    {(["YANDEX", "GOOGLE"] as const).map((value) => <Button key={value} type="button" size="sm" variant={engine === value ? "default" : "outline"} aria-pressed={engine === value} onClick={() => setEngine(value)}>{value === "YANDEX" ? "Яндекс" : "Google"}</Button>)}
    {(["ALL", "DESKTOP", "MOBILE"] as const).map((value) => <Button key={value} type="button" size="sm" variant={device === value ? "secondary" : "outline"} aria-pressed={device === value} onClick={() => setDevice(value)}>{value === "ALL" ? "Все устройства" : value === "DESKTOP" ? "Компьютеры" : "Телефоны"}</Button>)}
  </div>;
  return <Tabs defaultValue="overview">
    <TabsList aria-label="Разделы отчёта">
      <TabsTrigger value="overview">Обзор</TabsTrigger><TabsTrigger value="queries">Запросы и позиции</TabsTrigger><TabsTrigger value="pages">Страницы и заявки</TabsTrigger><TabsTrigger value="technical">Техническое состояние</TabsTrigger><TabsTrigger value="competitors">Конкуренты</TabsTrigger>
    </TabsList>
    <TabsContent value="overview" className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><KpiCard label="Органические визиты" value={formatInteger(metrica?.summary.visits ?? null)} tone="primary" /><KpiCard label="Отправленные заявки" value={formatInteger(lead?.reaches ?? null)} /><KpiCard label="Раскрытия телефона" value={formatInteger(phone?.reaches ?? null)} /><KpiCard label="Уникальные целевые визиты" value={formatInteger(metrica?.summary.targetVisits ?? null)} tone="soft" /></div>
      <SectionCard title="Путь от показа до заявки" note={`Сводка разных источников · часовой пояс ${timezone}`}><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[["Показы Вебмастера", webmaster?.summary.shows], ["Клики Вебмастера", webmaster?.summary.clicks], ["Визиты Метрики", metrica?.summary.visits], ["Уникальные целевые визиты", metrica?.summary.targetVisits]].map(([label, value]) => <div className="rounded-[var(--radius)] bg-[var(--muted)] p-4" key={String(label)}><p className="text-xs text-app-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{formatInteger(typeof value === "number" ? value : null)}</p></div>)}</div><p className="mt-3 text-xs text-app-muted-foreground">Показатели получены из разных систем, поэтому один визит нельзя напрямую связать с конкретным запросом.</p></SectionCard>
    </TabsContent>
    <TabsContent value="queries" className="space-y-4">
      {selectors}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><KpiCard label="Поисковые запросы" value={formatInteger(ranking?.queryCount ?? null)} /><KpiCard label="Топ‑3" value={formatInteger(ranking?.top3Count ?? null)} /><KpiCard label="Топ‑10" value={formatInteger(ranking?.top10Count ?? null)} /><KpiCard label="Средняя позиция Яндекса" value={formatPosition(webmaster?.summary.avgPosition ?? null)} /></div>
      {webmasterQueries.length ? <SectionCard title="Спрос и видимость в Яндексе" note="Средняя позиция Вебмастера и точная позиция Topvisor могут различаться"><DataTable caption="Запросы Вебмастера" columns={["Запрос", "Устройство", "Спрос", "Показы", "Клики", "Кликабельность", "Позиция", "Страница"]} rows={webmasterQueries.slice(0, 30).map((row, index) => ({ key: `${row.query}-${row.device}-${index}`, cells: [row.query, row.device === "DESKTOP" ? "Компьютеры" : "Телефоны", formatInteger(row.demand), formatInteger(row.shows), formatInteger(row.clicks), formatPercent(row.ctr), formatPosition(row.averagePosition), row.relevantUrl ?? "—"] }))} /></SectionCard> : engine === "YANDEX" ? <StatePanel state="empty" title="Запросы ещё не собраны" description="Данные появятся после очередного обновления Вебмастера." /> : null}
      {phrases.length ? <SectionCard title="Фразы, которые привели посетителей" note="Метрика · неизвестные фразы сохранены"><DataTable caption="Поисковые фразы" columns={["Система", "Фраза", "Визиты", "Целевые визиты"]} rows={phrases.slice(0, 30).map((row, index) => ({ key: `${row.engine}-${row.phrase}-${index}`, cells: [row.engine === "YANDEX" ? "Яндекс" : "Google", row.phrase, formatInteger(row.visits), formatInteger(row.uniqueTargetVisits)] }))} /></SectionCard> : <StatePanel state="empty" title="Поисковые фразы ещё не собраны" description={`Метрика ещё не вернула распознанные фразы для ${engine === "YANDEX" ? "Яндекса" : "Google"}.`} />}
    </TabsContent>
    <TabsContent value="pages" className="space-y-4">
      {metrica?.landingPages.length ? <SectionCard title="Посадочные страницы" note={`Метрика · часовой пояс ${timezone}`}><DataTable caption="Эффективность страниц" columns={["Страница", "Визиты", "Пользователи", "Заявки и звонки", "Конверсия"]} rows={metrica.landingPages.slice(0, 30).map((row) => ({ key: row.path, cells: [row.path, formatInteger(row.visits), formatInteger(row.users), formatInteger(row.targetVisits), formatPercent(row.conversionRate)] }))} /></SectionCard> : <StatePanel state="empty" title="Нет данных по страницам" description="Метрика ещё не вернула данные за выбранный период." />}
      {analytics?.regions.length ? <SectionCard title="Основные регионы" note="Пять регионов с наибольшим органическим трафиком"><DataTable caption="География органического трафика" columns={["Регион", "Визиты", "Целевые визиты"]} rows={analytics.regions.map((row) => ({ key: row.regionKey, cells: [row.regionName, formatInteger(row.visits), formatInteger(row.uniqueTargetVisits)] }))} /></SectionCard> : null}
    </TabsContent>
    <TabsContent value="technical" className="space-y-4">
      {webmaster?.health ? <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><KpiCard label="Страницы в поиске" value={formatInteger(webmaster.health.pagesInSearch)} /><KpiCard label="Исключено" value={formatInteger(webmaster.health.excludedPages)} /><KpiCard label="Ошибки загрузки страниц" value={formatInteger(webmaster.health.http4xx + webmaster.health.http5xx)} /><KpiCard label="Индекс качества сайта" value={formatInteger(webmaster.health.sqi)} /></div><SectionCard title="Ошибки и ссылки"><DataTable caption="Состояние сайта" columns={["Показатель", "Значение"]} rows={[["Критические проблемы", webmaster.health.fatalCount + webmaster.health.criticalCount], ["Ошибки карты сайта", webmaster.health.sitemapErrors], ["Неработающие внутренние ссылки", webmaster.links.brokenInternal], ["Внешние ссылки", webmaster.links.external]].map(([label, value]) => ({ key: String(label), cells: [String(label), formatInteger(Number(value))] }))} /></SectionCard></> : <StatePanel state="empty" title="Данные о состоянии сайта недоступны" description="Вебмастер не подключён или обновление ещё не завершилось." />}
    </TabsContent>
    <TabsContent value="competitors" className="space-y-4">
      {selectors}
      {competitors.length ? <SectionCard title="Ведущие сайты" note={`Topvisor · данные на ${analytics?.competitorCapturedAt ? new Date(analytics.competitorCapturedAt).toLocaleString("ru-RU", { timeZone: timezone }) : "—"}`}><DataTable caption="Конкуренты в поисковой выдаче" columns={["Система", "Устройство", "Сайт", "Видимость", "Средняя позиция", "Топ‑3", "Топ‑10", "Топ‑30"]} rows={competitors.map((row, index) => ({ key: `${row.engine}-${row.device}-${row.domain}-${index}`, cells: [row.engine === "YANDEX" ? "Яндекс" : "Google", row.device === "DESKTOP" ? "Компьютеры" : "Телефоны", row.domain, formatPercent(row.visibility), formatPosition(row.averagePosition), formatInteger(row.top3), formatInteger(row.top10), formatInteger(row.top30)] }))} /></SectionCard> : <StatePanel state="empty" title="Данные о конкурентах ещё не готовы" description="Первые данные появятся после настройки Topvisor, затем будут обновляться раз в месяц." />}
    </TabsContent>
  </Tabs>;
}
