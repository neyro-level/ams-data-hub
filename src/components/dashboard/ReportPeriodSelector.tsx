"use client";

import { parseAsStringLiteral, useQueryState } from "nuqs";
import type { ReportPeriodKey } from "../../shared/schemas/report.ts";
import { Button } from "../ui/button.tsx";

const periodKeys = ["week", "month", "quarter", "halfYear"] as const;
const periods: Array<{ key: ReportPeriodKey; label: string }> = [{ key: "week", label: "Неделя" }, { key: "month", label: "Месяц" }, { key: "quarter", label: "3 месяца" }, { key: "halfYear", label: "Полгода" }];

export function ReportPeriodSelector({ active, onChange }: { active: ReportPeriodKey; onChange?: (period: ReportPeriodKey) => void }) {
  const [, setPeriod] = useQueryState("period", parseAsStringLiteral(periodKeys).withDefault(active));
  return <div className="inline-flex max-w-full overflow-x-auto rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--card)] p-1 shadow-[var(--shadow-surface)]" aria-label="Период отчёта">{periods.map((period) => { const selected = active === period.key; return <Button key={period.key} type="button" variant={selected ? "default" : "ghost"} className="h-10 min-h-10 shrink-0 px-2 sm:px-4" aria-pressed={selected} onClick={() => { if (onChange) onChange(period.key); else void setPeriod(period.key, { history: "replace", shallow: false }); }}>{period.label}</Button>; })}</div>;
}
