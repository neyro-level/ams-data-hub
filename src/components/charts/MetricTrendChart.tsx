"use client";

import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  XAxis,
  YAxis,
} from "recharts";
import { ChartContainer, ChartTooltip } from "../ui/chart.tsx";
import { formatInteger, formatPosition } from "../../shared/format/metrics.ts";
import type { TrendPoint } from "../../shared/schemas/report.ts";
import { AnalyticsCard, ChartEmptyState } from "./AnalyticsCard.tsx";

function toDisplayNumber(value: unknown) {
  return typeof value === "number" ? value : null;
}

type MetricTrendChartProps = {
  title: string;
  subtitle: string;
  data: TrendPoint[];
  metricLabel: string;
  secondaryMetricLabel?: string;
  tertiaryMetricLabel?: string;
  period?: string;
  timezone: string;
};

export function MetricTrendChart({
  title,
  subtitle,
  data,
  metricLabel,
  secondaryMetricLabel,
  tertiaryMetricLabel,
  period,
  timezone,
}: MetricTrendChartProps) {
  const gradientId = useId();

  if (data.length === 0) return <ChartEmptyState title={title} description="За выбранный период нет точек для построения графика." />;

  return (
    <AnalyticsCard title={title} description={subtitle} period={period} units={secondaryMetricLabel ? `${metricLabel}, ${secondaryMetricLabel}` : metricLabel} timezone={timezone} summary={<div className="grid gap-2 text-sm text-app-secondary sm:grid-cols-3"><p>{metricLabel}: <strong className="tabular-nums text-app-foreground">{formatInteger(data.at(-1)?.value)}</strong></p>{secondaryMetricLabel ? <p>{secondaryMetricLabel}: <strong className="tabular-nums text-app-foreground">{formatInteger(data.at(-1)?.secondaryValue ?? null)}</strong></p> : null}{tertiaryMetricLabel ? <p>{tertiaryMetricLabel}: <strong className="tabular-nums text-app-foreground">{formatPosition(data.at(-1)?.tertiaryValue ?? null)}</strong></p> : null}</div>}>
      <ChartContainer className="h-[280px]" config={{ value: { label: metricLabel, color: "var(--chart-1)" }, secondaryValue: { label: secondaryMetricLabel ?? "", color: "var(--chart-2)" } }}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-value)" stopOpacity={0.18} />
                <stop offset="100%" stopColor="var(--color-value)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
            <YAxis yAxisId="primary" axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
            <ChartTooltip
              contentStyle={{
                borderRadius: "var(--radius)",
                border: "1px solid var(--border)",
                boxShadow: "var(--shadow-overlay)",
              }}
              labelStyle={{ color: "var(--muted-foreground)", fontSize: 12 }}
              formatter={(value, name) => [
                formatInteger(toDisplayNumber(value)),
                name === "secondaryValue" ? secondaryMetricLabel : metricLabel,
              ]}
            />
            <Area
              type="monotone"
              yAxisId="primary"
              dataKey="value"
              stroke="var(--color-value)"
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              activeDot={{ r: 4 }}
            />
            {secondaryMetricLabel ? (
              <>
                <YAxis yAxisId="secondary" orientation="right" hide domain={[0, "auto"]} />
                <Line
                  type="monotone"
                  dataKey="secondaryValue"
                  yAxisId="secondary"
                  stroke="var(--color-secondaryValue)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  connectNulls
                />
              </>
            ) : null}
          </AreaChart>
      </ChartContainer>
    </AnalyticsCard>
  );
}
