"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { formatInteger, formatPercent } from "../../shared/format/metrics.ts";
import { ChartContainer, ChartTooltip } from "../ui/chart.tsx";
import { AnalyticsCard, ChartEmptyState } from "./AnalyticsCard.tsx";

function toDisplayNumber(value: unknown) {
  return typeof value === "number" ? value : null;
}

type DeviceBarChartProps = {
  timezone: string;
  data: Array<{
    device: string;
    visits: number;
    conversionRate: number | null;
  }>;
};

export function DeviceBarChart({ data, timezone }: DeviceBarChartProps) {
  if (data.length === 0) return <ChartEmptyState title="Устройства" description="За выбранный период нет данных по устройствам." />;
  const visitsTotal = data.reduce((total, item) => total + item.visits, 0);
  return (
    <AnalyticsCard title="Устройства" description="Как распределяются визиты и конверсия между типами устройств." units="визиты и проценты" timezone={timezone} summary={<p className="text-sm text-app-secondary">Всего визитов: <strong className="tabular-nums text-app-foreground">{formatInteger(visitsTotal)}</strong></p>}>
      <ChartContainer className="h-[280px]" config={{ visits: { label: "Визиты", color: "var(--chart-1)" } }}>
          <BarChart data={data}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="device" axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
            <ChartTooltip
              contentStyle={{
                borderRadius: "var(--radius)",
                border: "1px solid var(--border)",
                boxShadow: "var(--shadow-overlay)",
              }}
              formatter={(value) => [formatInteger(toDisplayNumber(value)), "Визиты"]}
            />
            <Bar dataKey="visits" fill="var(--color-visits)" radius={[6, 6, 0, 0]} maxBarSize={28} />
          </BarChart>
      </ChartContainer>
      <ul className="mt-4 grid gap-2 text-sm text-app-secondary sm:grid-cols-2">
        {data.map((item) => (
          <li key={item.device} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 py-2">
            <span className="font-semibold text-app-foreground">{item.device}</span>: {formatInteger(item.visits)} визитов, {formatPercent(item.conversionRate)} конверсия
          </li>
        ))}
      </ul>
    </AnalyticsCard>
  );
}
