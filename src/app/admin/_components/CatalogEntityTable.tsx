"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { AdminDataTable } from "../../../components/tables/AdminDataTable.tsx";
import { dataHubTableFeatures } from "../../../components/tables/tanstack.ts";
import { StatusBadge } from "../../../components/states/StatusBadge.tsx";

export interface CatalogDisplayRow {
  id: string;
  primary: string;
  secondary: string;
  status: string;
  updatedAt: string;
}

const statusLabels: Record<string, string> = {
  ACTIVE: "Активен", INACTIVE: "Неактивен", ARCHIVED: "Архив",
};

export function CatalogEntityTable({ title, rows, filtersActive }: { title: string; rows: CatalogDisplayRow[]; filtersActive: boolean }) {
  const columns = useMemo<ColumnDef<typeof dataHubTableFeatures, CatalogDisplayRow, unknown>[]>(() => [
    { accessorKey: "primary", header: "Название", cell: ({ row }) => <div><p className="font-semibold text-app-foreground">{row.original.primary}</p><p className="mt-1 text-xs leading-5 text-app-muted-foreground">{row.original.secondary}</p></div> },
    { accessorKey: "status", header: "Статус", cell: ({ row }) => <StatusBadge label={statusLabels[row.original.status] ?? row.original.status} tone={row.original.status === "ACTIVE" ? "success" : row.original.status === "ARCHIVED" ? "muted" : "info"} /> },
    { accessorKey: "updatedAt", header: "Обновлено", cell: ({ row }) => <time className="block whitespace-nowrap text-right text-sm tabular-nums text-app-secondary" dateTime={row.original.updatedAt}>{new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(row.original.updatedAt))}</time> },
  ], []);
  return <section aria-labelledby={`${title}-title`} className="space-y-3"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold text-app-foreground" id={`${title}-title`}>{title}</h2><span className="text-sm tabular-nums text-app-muted-foreground">{rows.length}</span></div><AdminDataTable ariaLabel={title} columns={columns} data={rows} filtersActive={filtersActive} emptyTitle="Записей пока нет" emptyDescription="Создайте первую запись в форме ниже." filteredEmptyDescription="Измените фильтры или сбросьте поиск." mobileRenderer={(row) => <article className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4"><div className="flex items-start justify-between gap-3"><h3 className="font-semibold text-app-foreground">{row.primary}</h3><StatusBadge label={statusLabels[row.status] ?? row.status} tone={row.status === "ACTIVE" ? "success" : row.status === "ARCHIVED" ? "muted" : "info"} /></div><p className="mt-2 text-xs leading-5 text-app-muted-foreground">{row.secondary}</p></article>} nextHref="/admin/catalog/" page={1} pageCount={1} previousHref="/admin/catalog/" /></section>;
}
