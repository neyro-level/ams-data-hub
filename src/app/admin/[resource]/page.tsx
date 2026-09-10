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
  listMemberships,
  listOrganizations,
  listUsers,
} from "../../../modules/identity-access/server.ts";
import {
  getPlatformAdminDashboardSummary,
} from "../../../modules/platform-admin/server.ts";
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
  listOperations,
} from "../../../modules/platform-operations/server.ts";
import {
  getProjectRegistryAdminFormOptions,
  listGoalDefinitions,
  listProviderConnections,
  listQueryClusterProfiles,
  listSites,
  listThresholdProfiles,
  listTrackedQuerySets,
} from "../../../modules/project-registry/server.ts";
import { AdminResourceNav } from "../_components/AdminResourceNav.tsx";
import {
  ClientProvisioningAdmin,
  MembershipsAdminForms,
  OrganizationsAdminForms,
} from "../_components/IdentityAdminForms.tsx";
import { OperationsAdminForms } from "../_components/OperationsAdminForms.tsx";
import { PlatformAdminTable, type PlatformAdminDisplayRow } from "../_components/PlatformAdminTable.tsx";
import { GoalDefinitionsAdminForms } from "../_components/GoalDefinitionAdminForms.tsx";
import { ProviderConnectionsAdminForms } from "../_components/ProviderConnectionAdminForms.tsx";
import { QueryClusterProfilesAdminForms } from "../_components/QueryClusterProfileAdminForms.tsx";
import { SitesAdminForms } from "../_components/SiteAdminForms.tsx";
import { ThresholdProfilesAdminForms } from "../_components/ThresholdProfileAdminForms.tsx";
import { TrackedQuerySetsAdminForms } from "../_components/TrackedQuerySetAdminForms.tsx";

const defaultSortOptions: Array<{ field: PlatformAdminSortField; label: string }> = [
  { field: "name", label: "Запись" },
  { field: "status", label: "Статус" },
  { field: "updatedAt", label: "Обновлено" },
];

const accessLevelLabels: Record<string, string> = {
  ORG_OWNER: "Владелец организации",
  ORG_MEMBER: "Сотрудник организации",
  VIEWER: "Только просмотр",
};
const sourceLabels: Record<string, string> = {
  OWNER_PROVIDED: "Задано вручную",
  TOPVISOR: "Topvisor",
  YANDEX_WEBMASTER: "Яндекс.Вебмастер",
  YANDEX_METRIKA: "Яндекс.Метрика",
};
const goalCategoryLabels: Record<string, string> = {
  LEAD_SUBMIT: "Отправка заявки",
  PHONE_CLICK: "Раскрытие телефона",
  MESSENGER_CLICK: "Переход в мессенджер",
  FORM_START: "Начало заполнения формы",
  FILE_DOWNLOAD: "Скачивание файла",
  OTHER: "Другое действие",
};
const goalDirectionLabels: Record<string, string> = {
  PRIMARY: "Основная цель",
  SECONDARY: "Дополнительная цель",
};

function Filters({ query, resource }: { query: PlatformAdminPageQuery; resource: string }) {
  return (
    <form className="grid gap-3 rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--card)] p-4 sm:grid-cols-[minmax(0,1fr)_180px_160px_auto]" method="get">
      <label className="space-y-1.5">
        <span className="block text-sm font-medium text-app-foreground">Поиск</span>
        <Input defaultValue={query.search} name="q" placeholder="Название или адрес" />
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
  sites,
  enabledProviders,
  runningSyncs,
  pendingJobs,
}: PlatformAdminDashboardSummary) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      <KpiCard label="Организации" value={String(organizations)} tone="primary" />
      <KpiCard label="Проекты" value={String(projects)} />
      <KpiCard label="Сайты" value={String(sites)} />
      <KpiCard label="Источники" value={String(enabledProviders)} tone="soft" />
      <KpiCard label="Обновляются сейчас" value={String(runningSyncs)} />
      <KpiCard label="Ожидают запуска" value={String(pendingJobs)} />
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
  if (resource === "projects") redirect("/admin/projects/");
  if (!isPlatformAdminResourceKey(resource) || resource === "projects") notFound();

  const query = parsePlatformAdminPageQuery(rawSearchParams);
  const listQuery = toPlatformAdminListQuery(query);
  const definition = getPlatformAdminResourceDefinition(resource);
  const currentPath = `/admin/${resource}/`;

  if (resource === "organizations") {
    const [summary, result] = await Promise.all([
      getPlatformAdminDashboardSummary(),
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
      <>
        <div className="space-y-6">
          <PageHeader title={definition.label} description={definition.description} />
          <Summary {...summary} />
          <AdminResourceNav currentPath={currentPath} />
          <Filters query={query} resource={resource} />
          <PlatformAdminTable pageSize={result.pageSize} query={query} resource={resource} rows={rows} sortOptions={defaultSortOptions} total={result.total} />
          <OrganizationsAdminForms items={result.items} />
        </div>
      </>
    );
  }

  if (resource === "memberships") {
    const [summary, result, options, users, projectOptions] = await Promise.all([
      getPlatformAdminDashboardSummary(),
      listMemberships(state.principal, listQuery),
      getIdentityAdminFormOptions(state.principal),
      listUsers(state.principal),
      getProjectRegistryAdminFormOptions(state.principal),
    ]);
    const rows: PlatformAdminDisplayRow[] = result.items.map((item) => ({
      id: item.id,
      primary: item.userName,
      secondary: `${item.userEmail} · ${item.organizationName}`,
      status: accessLevelLabels[item.tenantRole] ?? "Доступ настроен",
      updatedAt: item.updatedAt,
    }));
    const pageCount = Math.max(1, Math.ceil(result.total / result.pageSize));
    if (query.page > pageCount) redirect(buildPlatformAdminPageHref(resource, query, { page: pageCount }));
    return (
      <>
        <div className="space-y-6">
          <PageHeader title={definition.label} description={definition.description} />
          <Summary {...summary} />
          <AdminResourceNav currentPath={currentPath} />
          <Filters query={query} resource={resource} />
          <PlatformAdminTable pageSize={result.pageSize} query={query} resource={resource} rows={rows} sortOptions={defaultSortOptions} total={result.total} />
          <MembershipsAdminForms items={result.items} options={options} />
          <ClientProvisioningAdmin users={users} thresholdProfiles={projectOptions.thresholdProfiles} clusterProfiles={projectOptions.clusterProfiles} />
        </div>
      </>
    );
  }

  if (resource === "sites") {
    const [summary, result, options] = await Promise.all([
      getPlatformAdminDashboardSummary(),
      listSites(state.principal, listQuery),
      getProjectRegistryAdminFormOptions(state.principal),
    ]);
    const rows: PlatformAdminDisplayRow[] = result.items.map((item) => ({
      id: item.id,
      primary: item.name,
      secondary: `${item.projectName} · ${item.url}`,
      status: item.enabled ? "Включён" : "Отключён",
      updatedAt: item.updatedAt,
    }));
    return (
      <>
        <div className="space-y-6">
          <PageHeader title={definition.label} description={definition.description} />
          <Summary {...summary} />
          <AdminResourceNav currentPath={currentPath} />
          <Filters query={query} resource={resource} />
          <PlatformAdminTable pageSize={result.pageSize} query={query} resource={resource} rows={rows} sortOptions={defaultSortOptions} total={result.total} />
          <SitesAdminForms items={result.items} options={options} />
        </div>
      </>
    );
  }

  if (resource === "providers") {
    const [summary, result, options] = await Promise.all([
      getPlatformAdminDashboardSummary(),
      listProviderConnections(state.principal, listQuery),
      getProjectRegistryAdminFormOptions(state.principal),
    ]);
    const rows: PlatformAdminDisplayRow[] = result.items.map((item) => ({
      id: item.id,
      primary: `${item.siteName} · ${sourceLabels[item.provider] ?? "Источник данных"}`,
      secondary: item.projectName,
      status: item.enabled ? "Включён" : "Отключён",
      updatedAt: item.updatedAt,
    }));
    return (
      <>
        <div className="space-y-6">
          <PageHeader title={definition.label} description={definition.description} />
          <Summary {...summary} />
          <AdminResourceNav currentPath={currentPath} />
          <Filters query={query} resource={resource} />
          <PlatformAdminTable pageSize={result.pageSize} query={query} resource={resource} rows={rows} sortOptions={defaultSortOptions} total={result.total} />
          <ProviderConnectionsAdminForms items={result.items} options={options} />
        </div>
      </>
    );
  }

  if (resource === "goals") {
    const [summary, result, options] = await Promise.all([
      getPlatformAdminDashboardSummary(),
      listGoalDefinitions(state.principal, listQuery),
      getProjectRegistryAdminFormOptions(state.principal),
    ]);
    const rows: PlatformAdminDisplayRow[] = result.items.map((item) => ({
      id: item.id,
      primary: item.label,
      secondary: `${item.projectName} · ${goalCategoryLabels[item.category] ?? "Целевое действие"}`,
      status: item.includeInSeoConversion ? "Учитывается в результате SEO" : (goalDirectionLabels[item.direction] ?? "Не учитывается"),
      updatedAt: item.updatedAt,
    }));
    return (
      <>
        <div className="space-y-6">
          <PageHeader title={definition.label} description={definition.description} />
          <Summary {...summary} />
          <AdminResourceNav currentPath={currentPath} />
          <Filters query={query} resource={resource} />
          <PlatformAdminTable pageSize={result.pageSize} query={query} resource={resource} rows={rows} sortOptions={defaultSortOptions} total={result.total} />
          <GoalDefinitionsAdminForms items={result.items} options={options} />
        </div>
      </>
    );
  }

  if (resource === "tracked-queries") {
    const [summary, result, options] = await Promise.all([
      getPlatformAdminDashboardSummary(),
      listTrackedQuerySets(state.principal, listQuery),
      getProjectRegistryAdminFormOptions(state.principal),
    ]);
    const rows: PlatformAdminDisplayRow[] = result.items.map((item) => ({
      id: item.id,
      primary: item.siteName,
      secondary: `${item.projectName} · ${item.enabledQueryCount} из ${item.expectedCount} запросов`,
      status: sourceLabels[item.source] ?? "Источник указан",
      updatedAt: item.updatedAt,
    }));
    return (
      <>
        <div className="space-y-6">
          <PageHeader title={definition.label} description={definition.description} />
          <Summary {...summary} />
          <AdminResourceNav currentPath={currentPath} />
          <Filters query={query} resource={resource} />
          <PlatformAdminTable pageSize={result.pageSize} query={query} resource={resource} rows={rows} sortOptions={defaultSortOptions} total={result.total} />
          <TrackedQuerySetsAdminForms items={result.items} options={options} />
        </div>
      </>
    );
  }

  if (resource === "profiles") {
    const [summary, thresholds, clusters] = await Promise.all([
      getPlatformAdminDashboardSummary(),
      listThresholdProfiles(state.principal, listQuery),
      listQueryClusterProfiles(state.principal, listQuery),
    ]);
    const thresholdRows: PlatformAdminDisplayRow[] = thresholds.items.map((item) => ({
      id: item.id,
      primary: `Правила оценки «${item.slug}»`,
      secondary: `Минимум показов ${item.minimumShows}`,
      status: "Настроено",
      updatedAt: item.updatedAt,
    }));
    const clusterRows: PlatformAdminDisplayRow[] = clusters.items.map((item) => ({
      id: item.id,
      primary: item.name,
      secondary: `${item.groups.length} групп запросов`,
      status: "Настроено",
      updatedAt: item.updatedAt,
    }));
    return (
      <>
        <div className="space-y-6">
          <PageHeader title={definition.label} description={definition.description} />
          <Summary {...summary} />
          <AdminResourceNav currentPath={currentPath} />
          <Filters query={query} resource={resource} />
          <PlatformAdminTable pageSize={thresholds.pageSize} query={query} resource={resource} rows={thresholdRows} sortOptions={defaultSortOptions} total={thresholds.total} />
          <PlatformAdminTable pageSize={clusters.pageSize} query={query} resource={resource} rows={clusterRows} sortOptions={defaultSortOptions} total={clusters.total} />
          <div className="space-y-6">
            <ThresholdProfilesAdminForms items={thresholds.items} />
            <QueryClusterProfilesAdminForms items={clusters.items} />
          </div>
        </div>
      </>
    );
  }

  if (resource === "operations") {
    const [summary, result] = await Promise.all([
      getPlatformAdminDashboardSummary(),
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
      <>
        <div className="space-y-6">
          <PageHeader title={definition.label} description={definition.description} />
          <Summary {...summary} />
          <AdminResourceNav currentPath={currentPath} />
          <Filters query={query} resource={resource} />
          <PlatformAdminTable pageSize={result.pageSize} query={query} resource={resource} rows={rows} sortOptions={defaultSortOptions} total={result.total} />
          <OperationsAdminForms />
        </div>
      </>
    );
  }

  notFound();
}
