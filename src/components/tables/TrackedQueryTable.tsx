"use client";

import { useMemo, useState } from "react";
import { formatInteger, formatPercent } from "../../shared/format/metrics.ts";
import type {
  RankingMovement,
  TrackedRankingReport,
} from "../../shared/schemas/report.ts";
import { Button } from "../ui/button.tsx";
import { DataTable } from "./DataTable.tsx";

type RankingFilter =
  | "all"
  | "top3"
  | "top10"
  | "top20"
  | "improved"
  | "declined"
  | "new"
  | "lost";

type TrackedQueryTableProps = {
  ranking: TrackedRankingReport;
};

const movementLabels: Record<RankingMovement, string> = {
  improved: "Вырос",
  declined: "Упал",
  unchanged: "Без изменений",
  new: "Новый",
  lost: "Потерян",
  unmeasured: "Нет сравнения",
};

function positionLabel(value: number | null) {
  return value === null ? "—" : String(value);
}

function deltaLabel(value: number | null) {
  if (value === null) return "—";
  if (value === 0) return "0";
  return `${value > 0 ? "+" : ""}${value}`;
}

export function TrackedQueryTable({ ranking }: TrackedQueryTableProps) {
  const [filter, setFilter] = useState<RankingFilter>("all");
  const [expanded, setExpanded] = useState(false);
  const filters: Array<{ key: RankingFilter; label: string; count: number }> = [
    { key: "all", label: "Все", count: ranking.queryCount },
    { key: "top3", label: "Топ-3", count: ranking.top3Count },
    { key: "top10", label: "Топ-10", count: ranking.top10Count },
    {
      key: "top20",
      label: "11–20",
      count: ranking.queries.filter(
        (query) =>
          query.currentPosition !== null &&
          query.currentPosition >= 11 &&
          query.currentPosition <= 20,
      ).length,
    },
    { key: "improved", label: "Выросшие", count: ranking.improvedCount },
    { key: "declined", label: "Упавшие", count: ranking.declinedCount },
    { key: "new", label: "Новые", count: ranking.newCount },
    { key: "lost", label: "Потерянные", count: ranking.lostCount },
  ];
  const filteredQueries = useMemo(
    () =>
      ranking.queries.filter((query) => {
        if (filter === "all") return true;
        if (filter === "top3")
          return query.currentPosition !== null && query.currentPosition <= 3;
        if (filter === "top10")
          return query.currentPosition !== null && query.currentPosition <= 10;
        if (filter === "top20")
          return (
            query.currentPosition !== null &&
            query.currentPosition >= 11 &&
            query.currentPosition <= 20
          );
        return query.movement === filter;
      }),
    [filter, ranking.queries],
  );
  const visibleQueries = expanded ? filteredQueries : filteredQueries.slice(0, 20);

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex max-w-full gap-2 overflow-x-auto pb-1" aria-label="Фильтры поискового ядра">
        {filters.map((item) => (
          <Button
            key={item.key}
            type="button"
            variant={filter === item.key ? "default" : "outline"}
            aria-pressed={filter === item.key}
            onClick={() => {
              setFilter(item.key);
              setExpanded(false);
            }}
            className={[
              "h-10 min-h-10 shrink-0 gap-2 rounded-[var(--radius)] px-3",
              filter === item.key
                ? "border-[var(--primary)] bg-[var(--primary)] text-app-primary-foreground"
                : "border-[var(--border)] bg-[var(--card)] text-app-secondary hover:border-[var(--primary)]",
            ].join(" ")}
          >
            {item.label}
            <span className={filter === item.key ? "text-app-primary-foreground opacity-75" : "text-app-muted-foreground"}>
              {item.count}
            </span>
          </Button>
        ))}
      </div>

      <DataTable
        caption={`Отслеживаемое поисковое ядро: ${ranking.queryCount} запросов`}
        columns={["Запрос", "Позиция", `На ${ranking.baselineLabel}`, "Изменение", "Показы", "Клики", "CTR"]}
        rows={visibleQueries.map((query) => ({
          key: query.query,
          cells: [
            <div key="query" className="min-w-[250px]">
              <p className="font-semibold text-app-foreground">{query.query}</p>
              <p className="mt-1 text-xs text-app-muted-foreground">
                {query.cluster} · {movementLabels[query.movement]}
              </p>
            </div>,
            <span key="position" className="font-semibold tabular-nums text-app-foreground">
              {positionLabel(query.currentPosition)}
            </span>,
            <span key="previous" className="tabular-nums">
              {positionLabel(query.previousPosition)}
            </span>,
            <span
              key="delta"
              className={[
                "font-semibold tabular-nums",
                query.positionDelta !== null && query.positionDelta > 0
                  ? "text-app-success"
                  : query.positionDelta !== null && query.positionDelta < 0
                    ? "text-app-destructive"
                    : "text-app-muted-foreground",
              ].join(" ")}
            >
              {deltaLabel(query.positionDelta)}
            </span>,
            <span key="shows" className="tabular-nums">{formatInteger(query.shows)}</span>,
            <span key="clicks" className="tabular-nums">{formatInteger(query.clicks)}</span>,
            <span key="ctr" className="tabular-nums">{formatPercent(query.ctr, 2)}</span>,
          ],
        }))}
      />

      {filteredQueries.length > 20 ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => setExpanded((value) => !value)}
          className="rounded-[var(--radius)] border-[var(--border)] text-app-foreground hover:border-[var(--primary)] hover:text-app-primary"
        >
          {expanded ? "Показать первые 20" : `Показать все ${filteredQueries.length}`}
        </Button>
      ) : null}
    </div>
  );
}
