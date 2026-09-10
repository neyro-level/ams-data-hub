export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import type { SearchParams } from "nuqs/server";
import { Button } from "../../../components/ui/button.tsx";
import { Input } from "../../../components/ui/input.tsx";
import { NativeSelect, NativeSelectOption } from "../../../components/ui/native-select.tsx";
import {
  getProjectFormOptions,
  listProjects,
} from "../../../modules/project-registry/server.ts";
import { hasPermission } from "../../../platform/authorization/principal.ts";
import { getCurrentPrincipalState } from "../../../platform/auth/principal-session.ts";
import { ProjectCreateForm } from "./_components/ProjectForms.tsx";
import { ProjectTable } from "./_components/ProjectTable.tsx";
import { PermissionDeniedState, StatePanel } from "../../../components/states/StatePanel.tsx";
import {
  loadProjectSearchParams,
  serializeProjectSearchParams,
} from "./search-params.ts";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const state = await getCurrentPrincipalState();
  if (!state) redirect("/?login=1");

  if (!hasPermission(state.principal, "project:manage:any")) {
    return (
      <>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <PermissionDeniedState title="Раздел недоступен" description="У текущей роли нет права управлять проектами." />
        </main>
      </>
    );
  }

  const parsed = await loadProjectSearchParams(searchParams);
  const query = {
    page: Math.max(1, parsed.page),
    pageSize: 20,
    search: parsed.search.trim().slice(0, 100),
    status: parsed.status,
    sort: parsed.sort,
    direction: parsed.direction,
  } as const;
  const [projects, options] = await Promise.all([
    listProjects(state.principal, query),
    getProjectFormOptions(state.principal),
  ]);
  const pageCount = Math.max(1, Math.ceil(projects.total / projects.pageSize));
  if (query.page > pageCount) {
    redirect(serializeProjectSearchParams("/admin/projects", { ...parsed, page: pageCount }));
  }
  const hasRequiredOptions =
    options.organizations.length > 0 &&
    options.thresholdProfiles.length > 0 &&
    options.clusterProfiles.length > 0;
  const filtersActive = Boolean(query.search || query.status);

  return (
    <>
      <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-app-info">Администрирование</p>
          <h1 className="mt-2 text-2xl font-semibold text-app-foreground">Проекты</h1>
          <p className="mt-2 text-sm text-app-secondary">Найдено проектов: {projects.total}</p>
        </header>

        {hasRequiredOptions ? (
          <ProjectCreateForm options={options} />
        ) : (
          <StatePanel state="not-connected" title="Создание проекта недоступно" description="Сначала добавьте организацию, правила оценки и группы поисковых запросов." />
        )}

        <form className="grid gap-4 rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--card)] p-4 sm:grid-cols-[minmax(0,1fr)_220px_auto]" method="get">
          <label className="space-y-1.5">
            <span className="block text-sm font-medium text-app-foreground">Поиск</span>
            <Input
              defaultValue={query.search}
              maxLength={100}
              name="search"
              placeholder="Название или адрес"
            />
          </label>
          <label className="space-y-1.5">
            <span className="block text-sm font-medium text-app-foreground">Статус</span>
            <NativeSelect
              defaultValue={query.status ?? ""}
              name="status"
            >
              <NativeSelectOption value="">Все статусы</NativeSelectOption>
              <NativeSelectOption value="ACTIVE">Активные</NativeSelectOption>
              <NativeSelectOption value="PLANNED">Запланированные</NativeSelectOption>
              <NativeSelectOption value="DISABLED">Отключённые</NativeSelectOption>
            </NativeSelect>
          </label>
          <div className="flex items-end gap-2">
            <Button type="submit">Применить</Button>
            {filtersActive ? <Link className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-app-muted-foreground hover:text-app-foreground" href="/admin/projects">Сбросить</Link> : null}
          </div>
        </form>

        <ProjectTable
          options={options}
          query={{
            page: query.page,
            search: query.search,
            status: query.status,
            sort: query.sort,
            direction: query.direction,
          }}
          result={projects}
        />
      </main>
    </>
  );
}
