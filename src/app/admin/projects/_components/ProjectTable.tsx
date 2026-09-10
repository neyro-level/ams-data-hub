"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { AdminDataTable } from "../../../../components/tables/AdminDataTable.tsx";
import { impulseTableFeatures } from "../../../../components/tables/tanstack.ts";
import { StatusBadge, type StatusTone } from "../../../../components/states/StatusBadge.tsx";
import type { ProjectFormOptions, ProjectListItem, ProjectListResult, ProjectStatus } from "../../../../modules/project-registry/contracts.ts";
import { ProjectRowActions } from "./ProjectForms.tsx";

export interface ProjectTableQuery { page: number; search: string; status: ProjectStatus | null; sort: "name" | "status" | "updatedAt"; direction: "asc" | "desc" }

const statuses: Record<ProjectStatus, { label: string; tone: StatusTone }> = {
  ACTIVE: { label: "Активен", tone: "success" },
  PLANNED: { label: "Запланирован", tone: "warning" },
  DISABLED: { label: "Отключён", tone: "neutral" },
};

function projectHref(query: ProjectTableQuery, patch: Partial<ProjectTableQuery>) {
  const next = { ...query, ...patch };
  const params = new URLSearchParams();
  if (next.page > 1) params.set("page", String(next.page));
  if (next.search) params.set("search", next.search);
  if (next.status) params.set("status", next.status);
  if (next.sort !== "updatedAt") params.set("sort", next.sort);
  if (next.direction !== "desc") params.set("direction", next.direction);
  const value = params.toString();
  return value ? `/admin/projects?${value}` : "/admin/projects";
}

function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return <StatusBadge label={statuses[status].label} tone={statuses[status].tone} />;
}

function SortLink({ field, label, query }: { field: ProjectTableQuery["sort"]; label: string; query: ProjectTableQuery }) {
  const active = query.sort === field;
  const direction = active && query.direction === "asc" ? "desc" : "asc";
  return <Link className="inline-flex min-h-11 items-center gap-1 text-left text-xs font-semibold uppercase tracking-wide text-app-secondary" href={projectHref(query, { page: 1, sort: field, direction })}>{label}{active ? query.direction === "asc" ? <ChevronUp className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5 opacity-30" aria-hidden />}</Link>;
}

export function ProjectTable({ result, options, query }: { result: ProjectListResult; options: ProjectFormOptions; query: ProjectTableQuery }) {
  const columns = useMemo<ColumnDef<typeof impulseTableFeatures, ProjectListItem, unknown>[]>(() => [
    { accessorKey: "name", header: () => <SortLink field="name" label="Проект" query={query} />, cell: ({ row }) => <p className="font-semibold text-app-foreground">{row.original.name}</p> },
    { accessorKey: "organizationName", header: "Организация", cell: ({ row }) => <span className="text-sm text-app-secondary">{row.original.organizationName}</span> },
    { accessorKey: "status", header: () => <SortLink field="status" label="Статус" query={query} />, cell: ({ row }) => <ProjectStatusBadge status={row.original.status} /> },
    { accessorKey: "updatedAt", header: () => <SortLink field="updatedAt" label="Обновлён" query={query} />, cell: ({ row }) => <time className="block whitespace-nowrap text-right text-sm tabular-nums text-app-secondary" dateTime={row.original.updatedAt}>{new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(new Date(row.original.updatedAt))}</time> },
    { id: "actions", header: "Управление", cell: ({ row }) => <ProjectRowActions key={`${row.original.id}:${row.original.version}`} project={row.original} options={options} /> },
  ], [options, query]);
  const pageCount = Math.max(1, Math.ceil(result.total / result.pageSize));
  return <AdminDataTable ariaLabel="Список проектов" columns={columns} data={result.items} filtersActive={Boolean(query.search || query.status)} emptyTitle="Проектов пока нет" emptyDescription="Создайте первый проект в форме ниже." filteredEmptyDescription="Измените фильтры или сбросьте их." page={result.page} pageCount={pageCount} previousHref={projectHref(query, { page: Math.max(1, result.page - 1) })} nextHref={projectHref(query, { page: Math.min(pageCount, result.page + 1) })} minWidth="980px" mobileRenderer={(project) => <article className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4"><div className="flex items-start justify-between gap-3"><h2 className="font-semibold text-app-foreground">{project.name}</h2><ProjectStatusBadge status={project.status} /></div><dl className="mt-4 text-sm"><div><dt className="text-xs text-app-muted-foreground">Организация</dt><dd className="mt-1 text-app-foreground">{project.organizationName}</dd></div></dl><div className="mt-4 border-t border-[var(--border)] pt-4"><ProjectRowActions key={`${project.id}:${project.version}`} project={project} options={options} /></div></article>} />;
}
