"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { AdminDataTable } from "../../../components/tables/AdminDataTable.tsx";
import { impulseTableFeatures } from "../../../components/tables/tanstack.ts";
import { StatusBadge, type StatusTone } from "../../../components/states/StatusBadge.tsx";
import { buildPlatformAdminPageHref, type PlatformAdminPageQuery, type PlatformAdminSortField } from "../../../modules/platform-admin/index.ts";

export interface PlatformAdminDisplayRow { id: string; primary: string; secondary: string; status: string; updatedAt: string }

function statusTone(status: string): StatusTone {
  const value = status.toLowerCase();
  if (value.includes("отключ") || value.includes("disabled")) return "neutral";
  if (value.includes("включ") || value.includes("active")) return "success";
  return "info";
}

function SortLink({ field, label, resource, query }: { field: PlatformAdminSortField; label: string; resource: string; query: PlatformAdminPageQuery }) {
  const active = query.sort === field;
  const direction = active && query.direction === "asc" ? "desc" : "asc";
  return <Link className="inline-flex min-h-11 items-center gap-1 text-left text-xs font-semibold uppercase tracking-wide text-app-secondary" href={buildPlatformAdminPageHref(resource, query, { page: 1, sort: field, direction })}>{label}{active ? query.direction === "asc" ? <ChevronUp className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5 opacity-30" aria-hidden />}</Link>;
}

export function PlatformAdminTable({ resource, query, rows, total, pageSize, sortOptions }: { resource: string; query: PlatformAdminPageQuery; rows: PlatformAdminDisplayRow[]; total: number; pageSize: number; sortOptions: Array<{ field: PlatformAdminSortField; label: string }> }) {
  const primarySort = sortOptions.find((item) => item.field === "name") ?? sortOptions.find((item) => item.field !== "status" && item.field !== "updatedAt");
  const columns = useMemo<ColumnDef<typeof impulseTableFeatures, PlatformAdminDisplayRow, unknown>[]>(() => [
    { accessorKey: "primary", header: () => <SortLink field={primarySort?.field ?? "name"} label={primarySort?.label ?? "Запись"} query={query} resource={resource} />, cell: ({ row }) => <div><p className="font-semibold text-app-foreground">{row.original.primary}</p><p className="mt-1 text-xs leading-5 text-app-muted-foreground">{row.original.secondary}</p></div> },
    { accessorKey: "status", header: () => <SortLink field="status" label="Статус" query={query} resource={resource} />, cell: ({ row }) => <StatusBadge label={row.original.status} tone={statusTone(row.original.status)} /> },
    { accessorKey: "updatedAt", header: () => <SortLink field="updatedAt" label="Обновлено" query={query} resource={resource} />, cell: ({ row }) => <time className="block whitespace-nowrap text-right text-sm tabular-nums text-app-secondary" dateTime={row.original.updatedAt}>{new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(row.original.updatedAt))}</time> },
  ], [primarySort, query, resource]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return <AdminDataTable ariaLabel="Список записей" columns={columns} data={rows} filtersActive={Boolean(query.search)} emptyTitle="Записей пока нет" emptyDescription="Создайте первую запись в форме ниже." filteredEmptyDescription="Измените поисковый запрос или сбросьте фильтр." page={query.page} pageCount={pageCount} previousHref={buildPlatformAdminPageHref(resource, query, { page: Math.max(1, query.page - 1) })} nextHref={buildPlatformAdminPageHref(resource, query, { page: Math.min(pageCount, query.page + 1) })} mobileRenderer={(row) => <article className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4"><div className="flex items-start justify-between gap-3"><h2 className="font-semibold text-app-foreground">{row.primary}</h2><StatusBadge label={row.status} tone={statusTone(row.status)} /></div><p className="mt-2 text-xs leading-5 text-app-muted-foreground">{row.secondary}</p><time className="mt-4 block text-xs tabular-nums text-app-muted-foreground" dateTime={row.updatedAt}>{new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(row.updatedAt))}</time></article>} />;
}
