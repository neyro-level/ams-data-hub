import type { ReactNode } from "react";
import { Skeleton } from "../ui/skeleton.tsx";
import { StatePanel } from "../states/StatePanel.tsx";

export function AnalyticsCard({ title, description, period, units, timezone, summary, children }: { title: string; description: string; period?: string; units: string; timezone: string; summary?: ReactNode; children: ReactNode }) {
  return <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-surface)] sm:p-5"><header className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="text-lg font-semibold leading-6 text-app-foreground">{title}</h3><p className="mt-1 text-sm leading-5 text-app-secondary">{description}</p></div><div className="shrink-0 text-xs text-app-muted-foreground">{period ? <p>Период: {period}</p> : null}<p>Единицы: {units}</p><p>Часовой пояс: {timezone}</p></div></header>{children}{summary ? <div className="mt-4 border-t border-[var(--border)] pt-3">{summary}</div> : null}</section>;
}

export function ChartSkeleton({ title = "Загрузка графика" }: { title?: string }) {
  return <section aria-label={title} className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-5"><Skeleton className="h-6 w-52" /><Skeleton className="mt-3 h-4 w-72 max-w-full" /><Skeleton className="mt-6 h-[280px] w-full" /></section>;
}

export function ChartEmptyState({ title, description }: { title: string; description: string }) {
  return <StatePanel state="empty" title={title} description={description} />;
}
