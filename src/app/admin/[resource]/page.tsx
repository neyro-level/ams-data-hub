export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { KpiCard } from "../../../components/dashboard/KpiCard.tsx";
import { PageHeader } from "../../../components/dashboard/PageHeader.tsx";
import { Button } from "../../../components/ui/button.tsx";
import { Input } from "../../../components/ui/input.tsx";
import { NativeSelect, NativeSelectOption } from "../../../components/ui/native-select.tsx";
import {
  getCurrentCabinetRedirect,
  getCurrentPrincipalState,
} from "../../../modules/identity-access/server.ts";
import {
  getIdentityAdminFormOptions,
  isClientAccessEnabled,
  listMemberships,
  listOrganizations,
  listUsers,
} from "../../../modules/identity-access/server.ts";
import {
  buildPlatformAdminPageHref,
  getPlatformAdminResourceDefinition,
  isPlatformAdminResourceKey,
  parsePlatformAdminPageQuery,
  toPlatformAdminListQuery,
  type PlatformAdminDashboardSummary,
  type PlatformAdminPageQuery,
  type PlatformAdminSortField,
} from "../../../modules/platform-admin/index.ts";
import {
  getPlatformAdminDashboardSummary,
} from "../../../modules/platform-admin/server.ts";
import {
  listOperations,
} from "../../../modules/platform-operations/server.ts";
import {
  getProjectRegistryFormOptions,
  listProjects,
} from "../../../modules/project-registry/server.ts";
import { listAgentsForAdmin, listProjectPublicContactsForAdmin } from "../../../modules/project-state/server.ts";
import { parseCatalogAdminQuery } from "../../../modules/shared-catalog/contracts.ts";
import { getCatalogAdminData } from "../../../modules/shared-catalog/server.ts";
import { getSourceAdminData } from "../../../modules/ingestion-core/server.ts";
import { AdminResourceNav } from "../_components/AdminResourceNav.tsx";
import {
  MembershipsAdminForms,
  OrganizationsAdminForms,
  UsersAdminForms,
} from "../_components/IdentityAdminForms.tsx";
import { OperationsAdminForms } from "../_components/OperationsAdminForms.tsx";
import { PlatformAdminTable, type PlatformAdminDisplayRow } from "../_components/PlatformAdminTable.tsx";
import { ProjectsAdminForms } from "../_components/ProjectAdminForms.tsx";
import { CatalogAdminWorkspace } from "../_components/CatalogAdminWorkspace.tsx";
import { SourceAdminForms } from "../_components/SourceAdminForms.tsx";

const defaultSortOptions: Array<{ field: PlatformAdminSortField; label: string }> = [
  { field: "name", label: "Запись" },
  { field: "status", label: "Статус" },
  { field: "updatedAt", label: "Обновлено" },
];

const accessLevelLabels: Record<string, string> = {
  ORG_ADMIN: "Владелец организации",
  ORG_EDITOR: "Сотрудник организации",
  ORG_VIEWER: "Только просмотр",
};

const projectStatusLabels: Record<string, string> = {
  ACTIVE: "Активен",
  PLANNED: "Планируется",
  DISABLED: "Отключён",
};

const projectServiceStateLabels: Record<string, string> = {
  ACTIVE: "Сервис активен",
  SUSPENDED: "Сервис приостановлен",
};

function Filters({ query, resource }: { query: PlatformAdminPageQuery; resource: string }) {
  return (
    <form className="grid gap-3 rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--card)] p-4 sm:grid-cols-[minmax(0,1fr)_180px_160px_auto]" method="get">
      <label className="space-y-1.5">
        <span className="block text-sm font-medium text-app-foreground">Поиск</span>
        <Input defaultValue={query.search} name="q" placeholder="Название, логин или адрес" />
      </label>
      <label className="space-y-1.5">
        <span className="block text-sm font-medium text-app-foreground">Сортировка</span>
        <NativeSelect defaultValue={query.sort} name="sort">
          <NativeSelectOption value="updatedAt">Обновлено</NativeSelectOption>
          <NativeSelectOption value="createdAt">Создано</NativeSelectOption>
          <NativeSelectOption value="name">Название</NativeSelectOption>
          <NativeSelectOption value="status">Статус</NativeSelectOption>
        </NativeSelect>
      </label>
      <label className="space-y-1.5">
        <span className="block text-sm font-medium text-app-foreground">Направление</span>
        <NativeSelect defaultValue={query.direction} name="direction">
          <NativeSelectOption value="desc">По убыванию</NativeSelectOption>
          <NativeSelectOption value="asc">По возрастанию</NativeSelectOption>
        </NativeSelect>
      </label>
      <div className="flex items-end gap-2">
        <Button type="submit">Применить</Button>
        {query.search || query.sort !== "updatedAt" || query.direction !== "desc" || query.page > 1 ? (
          <Link className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-app-muted-foreground hover:text-app-foreground" href={`/admin/${resource}/`}>
            Сбросить
          </Link>
        ) : null}
      </div>
    </form>
  );
}

function Summary({
  organizations,
  projects,
  users,
  pendingJobs,
}: PlatformAdminDashboardSummary) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard label="Организации" value={String(organizations)} tone="primary" />
      <KpiCard label="Проекты" value={String(projects)} />
      <KpiCard label="Пользователи" value={String(users)} />
      <KpiCard label="Ожидают запуска" value={String(pendingJobs)} tone="soft" />
    </section>
  );
}

export default async function AdminResourcePageRoute({
  params,
  searchParams,
}: {
  params: Promise<{ resource: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const cabinetRedirect = await getCurrentCabinetRedirect();
  if (cabinetRedirect) redirect(cabinetRedirect);

  const [state, routeParams, rawSearchParams] = await Promise.all([
    getCurrentPrincipalState(),
    params,
    searchParams,
  ]);
  if (!state) redirect("/?login=1");
  if (state.principal.kind !== "platform-admin") redirect("/dashboard/");

  const { resource } = routeParams;
  if (!isPlatformAdminResourceKey(resource)) notFound();

  const query = parsePlatformAdminPageQuery(rawSearchParams);
  const listQuery = toPlatformAdminListQuery(query);
  const definition = getPlatformAdminResourceDefinition(resource);
  const currentPath = `/admin/${resource}/`;

  if (resource === "catalog") {
    const catalogQuery = parseCatalogAdminQuery(rawSearchParams);
    const data = await getCatalogAdminData(state.principal, catalogQuery);
    return (
      <div className="space-y-6">
        <PageHeader title={definition.label} description={definition.description} />
        <AdminResourceNav currentPath={currentPath} />
        <CatalogAdminWorkspace data={data} query={catalogQuery} />
      </div>
    );
  }

  if (resource === "sources") {
    const data = await getSourceAdminData(state.principal);
    return (
      <div className="space-y-6">
        <PageHeader title={definition.label} description={definition.description} />
        <AdminResourceNav currentPath={currentPath} />
        <SourceAdminForms data={data} />
      </div>
    );
  }

  if (resource === "organizations") {
    const [summary, result] = await Promise.all([
      getPlatformAdminDashboardSummary(state.principal),
      listOrganizations(state.principal, listQuery),
    ]);
    const rows: PlatformAdminDisplayRow[] = result.items.map((item) => ({
      id: item.id,
      primary: item.name,
      secondary: `${item.projectCount} проектов · ${item.membershipCount} участников`,
      status: "Активна",
      updatedAt: item.updatedAt,
    }));
    const pageCount = Math.max(1, Math.ceil(result.total / result.pageSize));
    if (query.page > pageCount) redirect(buildPlatformAdminPageHref(resource, query, { page: pageCount }));
    return (
      <div className="space-y-6">
        <PageHeader title={definition.label} description={definition.description} />
        <Summary {...summary} />
        <AdminResourceNav currentPath={currentPath} />
        <Filters query={query} resource={resource} />
        <PlatformAdminTable pageSize={result.pageSize} query={query} resource={resource} rows={rows} sortOptions={defaultSortOptions} total={result.total} />
        <OrganizationsAdminForms items={result.items} />
      </div>
    );
  }

  if (resource === "memberships") {
    const clientAccessEnabled = isClientAccessEnabled();
    const [summary, result, options, users] = await Promise.all([
      getPlatformAdminDashboardSummary(state.principal),
      listMemberships(state.principal, listQuery),
      getIdentityAdminFormOptions(state.principal),
      listUsers(state.principal),
    ]);
    const rows: PlatformAdminDisplayRow[] = result.items.map((item) => ({
      id: item.id,
      primary: item.userName,
      secondary: `${item.userEmail} · ${item.organizationName}`,
      status: clientAccessEnabled
        ? accessLevelLabels[item.tenantRole] ?? "Доступ настроен"
        : "Клиентский доступ выключен",
      updatedAt: item.updatedAt,
    }));
    const pageCount = Math.max(1, Math.ceil(result.total / result.pageSize));
    if (query.page > pageCount) redirect(buildPlatformAdminPageHref(resource, query, { page: pageCount }));
    return (
      <div className="space-y-6">
        <PageHeader title={definition.label} description={definition.description} />
        <Summary {...summary} />
        <AdminResourceNav currentPath={currentPath} />
        <Filters query={query} resource={resource} />
        <PlatformAdminTable pageSize={result.pageSize} query={query} resource={resource} rows={rows} sortOptions={defaultSortOptions} total={result.total} />
        <UsersAdminForms clientAccessEnabled={clientAccessEnabled} options={options} users={users} />
        <MembershipsAdminForms clientAccessEnabled={clientAccessEnabled} items={result.items} options={options} />
      </div>
    );
  }

  if (resource === "projects") {
    const [summary, result, options] = await Promise.all([
      getPlatformAdminDashboardSummary(state.principal),
      listProjects(state.principal, listQuery),
      getProjectRegistryFormOptions(state.principal),
    ]);
    const projectIds = result.items.map((item) => item.id);
    const [contacts, agentData] = await Promise.all([
      listProjectPublicContactsForAdmin(state.principal, projectIds),
      listAgentsForAdmin(state.principal, projectIds),
    ]);
    const rows: PlatformAdminDisplayRow[] = result.items.map((item) => ({
      id: item.id,
      primary: item.name,
      secondary: `${item.organizationName} · ${item.slug}`,
      status: `${projectStatusLabels[item.status] ?? "Настроен"} · ${projectServiceStateLabels[item.serviceState] ?? "Сервис настроен"}`,
      updatedAt: item.updatedAt,
    }));
    const pageCount = Math.max(1, Math.ceil(result.total / result.pageSize));
    if (query.page > pageCount) redirect(buildPlatformAdminPageHref(resource, query, { page: pageCount }));
    return (
      <div className="space-y-6">
        <PageHeader title={definition.label} description={definition.description} />
        <Summary {...summary} />
        <AdminResourceNav currentPath={currentPath} />
        <Filters query={query} resource={resource} />
        <PlatformAdminTable pageSize={result.pageSize} query={query} resource={resource} rows={rows} sortOptions={defaultSortOptions} total={result.total} />
        <ProjectsAdminForms agents={agentData.agents} contacts={contacts} items={result.items} media={agentData.media} options={options} />
      </div>
    );
  }

  if (resource === "operations") {
    const [summary, result] = await Promise.all([
      getPlatformAdminDashboardSummary(state.principal),
      listOperations(state.principal, listQuery),
    ]);
    const rows: PlatformAdminDisplayRow[] = result.items.map((item) => ({
      id: item.id,
      primary: item.primary,
      secondary: item.secondary,
      status: item.status,
      updatedAt: item.updatedAt,
    }));
    return (
      <div className="space-y-6">
        <PageHeader title={definition.label} description={definition.description} />
        <Summary {...summary} />
        <AdminResourceNav currentPath={currentPath} />
        <Filters query={query} resource={resource} />
        <PlatformAdminTable pageSize={result.pageSize} query={query} resource={resource} rows={rows} sortOptions={defaultSortOptions} total={result.total} />
        <OperationsAdminForms />
      </div>
    );
  }

  notFound();
}
