"use client";

import * as React from "react";
import { ResponsiveContainer, Tooltip } from "recharts";
import { cn } from "../../shared/lib/cn.ts";

export type ChartConfig = Record<
  string,
  { label: React.ReactNode; color: string }
>;

export function ChartContainer({
  className,
  config,
  children,
}: React.HTMLAttributes<HTMLDivElement> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof ResponsiveContainer>["children"];
}) {
  const style = Object.fromEntries(
    Object.entries(config).map(([key, value]) => [`--color-${key}`, value.color]),
  ) as React.CSSProperties;

  return (
    <div
      data-slot="chart"
      className={cn("w-full min-w-0 text-xs [&_.recharts-cartesian-axis-tick_text]:fill-[var(--muted-foreground)]", className)}
      style={style}
    >
      <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
    </div>
  );
}

export const ChartTooltip = Tooltip;
