"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import type { TrackedRankingReport } from "../../shared/schemas/report.ts";
import { ChartContainer, ChartTooltip } from "../ui/chart.tsx";
import { AnalyticsCard, ChartEmptyState } from "./AnalyticsCard.tsx";

type RankingShareChartProps = {
  ranking: TrackedRankingReport;
  timezone: string;
};

export function RankingShareChart({ ranking, timezone }: RankingShareChartProps) {
  if (ranking.history.length < 2) {
    return (
      <ChartEmptyState title="Динамика Топ-3 и Топ-10" description="История начнёт формироваться после второй проверки позиций в Topvisor. Первый замер уже используется в текущих показателях." />
    );
  }

  return (
    <AnalyticsCard title="Доля запросов в Топ-3 и Топ-10" description={`Как меняется доля видимых в Яндексе запросов. Всего отслеживается: ${ranking.queryCount}.`} period={`${ranking.history[0]?.date} — ${ranking.history.at(-1)?.date}`} units="проценты и запросы" timezone={timezone} summary={<div className="flex flex-wrap gap-5 text-sm text-app-secondary"><span><span className="mr-2 inline-block size-2.5 rounded-full bg-[var(--chart-2)]" />Топ-10: <strong className="tabular-nums text-app-foreground">{ranking.top10Share.toFixed(1)}%</strong></span><span><span className="mr-2 inline-block size-2.5 rounded-full bg-[var(--chart-4)]" />Топ-3: <strong className="tabular-nums text-app-foreground">{ranking.top3Share.toFixed(1)}%</strong></span></div>}>
      <ChartContainer className="h-[300px]" config={{ top10Share: { label: "Топ-10", color: "var(--chart-2)" }, top3Share: { label: "Топ-3", color: "var(--chart-4)" } }}>
          <LineChart data={ranking.history}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
            <YAxis domain={[0, 100]} unit="%" axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
            <ChartTooltip
              contentStyle={{
                borderRadius: "var(--radius)",
                border: "1px solid var(--border)",
                boxShadow: "var(--shadow-overlay)",
              }}
              formatter={(value, name, item) => {
                const payload = item.payload as TrackedRankingReport["history"][number];
                if (name === "top3Share") {
                  return [`${Number(value).toFixed(1)}% · ${payload.top3Count} из ${ranking.queryCount}`, "Топ-3"];
                }
                return [`${Number(value).toFixed(1)}% · ${payload.top10Count} из ${ranking.queryCount}`, "Топ-10"];
              }}
            />
            <Line type="monotone" dataKey="top10Share" stroke="var(--color-top10Share)" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="top3Share" stroke="var(--color-top3Share)" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          </LineChart>
      </ChartContainer>
    </AnalyticsCard>
  );
}
