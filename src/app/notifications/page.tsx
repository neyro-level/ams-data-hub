export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { NotificationFeed } from "../../components/notifications/NotificationFeed.tsx";
import { PageHeader } from "../../components/dashboard/PageHeader.tsx";
import { Pagination } from "../../components/ui/pagination.tsx";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.tsx";
import { Button } from "../../components/ui/button.tsx";
import { getCurrentPrincipalState } from "../../modules/identity-access/server.ts";
import { getNotificationFilterOptions, listNotifications } from "../../modules/notifications/server.ts";
import { notificationCategorySchema } from "../../modules/notifications/index.ts";

type Search = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const categoryLabel = {
  ONBOARDING: "Настройка",
  INTEGRATION: "Подключения",
  REPORT: "Отчёты",
  RANKING: "Позиции",
  COMPETITOR: "Конкуренты",
  DATA_FRESHNESS: "Актуальность данных",
  QUEUE: "Задания",
  ACCESS: "Доступ",
} as const;
function href(search: Record<string, string>, page: number) { const params = new URLSearchParams(search); params.set("page", String(page)); return `/notifications/?${params}`; }

export default async function NotificationsPage({ searchParams }: { searchParams: Search }) {
  const state = await getCurrentPrincipalState(); if (!state) redirect("/?login=1");
  if (state.principal.kind !== "platform-admin" && state.principal.kind !== "platform-analyst") notFound();
  const raw = await searchParams; const page = Math.max(1, Number(first(raw.page) ?? 1) || 1); const stateFilter = first(raw.state); const category = notificationCategorySchema.safeParse(first(raw.category));
  const notificationState: "all" | "unread" | "attention" = stateFilter === "unread" || stateFilter === "attention" ? stateFilter : "all";
  const query = { page, pageSize: 20, state: notificationState, organizationId: first(raw.organizationId) || undefined, projectId: first(raw.projectId) || undefined, siteId: first(raw.siteId) || undefined, category: category.success ? category.data : undefined };
  const [result, options] = await Promise.all([listNotifications(state.principal, query), getNotificationFilterOptions(state.principal)]);
  const current = Object.fromEntries(Object.entries(raw).flatMap(([key, value]) => { const item = first(value); return item ? [[key, item]] : []; })); const pageCount = Math.max(1, Math.ceil(result.total / result.pageSize));
  return <div className="flex flex-col gap-6"><PageHeader title="Уведомления" description="История подключений, обновлений отчётов и событий, которые требуют внимания." /><form className="grid gap-3 rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--card)] p-4 sm:grid-cols-2 xl:grid-cols-5"><NativeSelect name="state" defaultValue={query.state}><NativeSelectOption value="all">Все</NativeSelectOption><NativeSelectOption value="unread">Непрочитанные</NativeSelectOption><NativeSelectOption value="attention">Требуют внимания</NativeSelectOption></NativeSelect><NativeSelect name="organizationId" defaultValue={query.organizationId ?? ""}><NativeSelectOption value="">Все организации</NativeSelectOption>{options.organizations.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}</NativeSelect><NativeSelect name="projectId" defaultValue={query.projectId ?? ""}><NativeSelectOption value="">Все проекты</NativeSelectOption>{options.projects.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}</NativeSelect><NativeSelect name="siteId" defaultValue={query.siteId ?? ""}><NativeSelectOption value="">Все сайты</NativeSelectOption>{options.sites.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}</NativeSelect><NativeSelect name="category" defaultValue={query.category ?? ""}><NativeSelectOption value="">Все категории</NativeSelectOption>{notificationCategorySchema.options.map((item) => <NativeSelectOption key={item} value={item}>{categoryLabel[item]}</NativeSelectOption>)}</NativeSelect><Button type="submit">Применить</Button></form><NotificationFeed items={result.items} /><Pagination page={result.page} pageCount={pageCount} previousHref={href(current, Math.max(1, result.page - 1))} nextHref={href(current, Math.min(pageCount, result.page + 1))} /></div>;
}
