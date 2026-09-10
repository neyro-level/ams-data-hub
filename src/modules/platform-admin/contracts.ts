import { z } from "zod";

export type PlatformAdminSortField = "name" | "status" | "createdAt" | "updatedAt";
export type PlatformAdminSortDirection = "asc" | "desc";

export interface PlatformAdminListQuery {
  page: number;
  pageSize: number;
  search: string;
  sort: PlatformAdminSortField;
  direction: PlatformAdminSortDirection;
}

export interface PlatformAdminPageQuery {
  page: number;
  search: string;
  sort: PlatformAdminSortField;
  direction: PlatformAdminSortDirection;
}

export interface PlatformAdminDashboardSummary {
  organizations: number;
  projects: number;
  sites: number;
  enabledProviders: number;
  runningSyncs: number;
  pendingJobs: number;
}

export interface PlatformAdminActionFailure {
  ok: false;
  code: string;
  message: string;
  correlationId: string;
  fieldErrors: Record<string, string[]>;
}

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  q: z.string().trim().max(160).default(""),
  sort: z.enum(["name", "status", "createdAt", "updatedAt"]).default("updatedAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
});

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function parsePlatformAdminPageQuery(
  searchParams: Record<string, string | string[] | undefined>,
): PlatformAdminPageQuery {
  const parsed = querySchema.parse({
    page: first(searchParams.page),
    q: first(searchParams.q),
    sort: first(searchParams.sort),
    direction: first(searchParams.direction),
  });
  return {
    page: parsed.page,
    search: parsed.q,
    sort: parsed.sort,
    direction: parsed.direction,
  };
}

export function toPlatformAdminListQuery(
  pageQuery: PlatformAdminPageQuery,
  pageSize = 20,
): PlatformAdminListQuery {
  return {
    page: pageQuery.page,
    pageSize,
    search: pageQuery.search,
    sort: pageQuery.sort,
    direction: pageQuery.direction,
  };
}

export function buildPlatformAdminPageHref(
  resource: string,
  query: PlatformAdminPageQuery,
  patch: Partial<PlatformAdminPageQuery>,
): string {
  const next = { ...query, ...patch };
  const params = new URLSearchParams();
  if (next.page > 1) params.set("page", String(next.page));
  if (next.search) params.set("q", next.search);
  if (next.sort !== "updatedAt") params.set("sort", next.sort);
  if (next.direction !== "desc") params.set("direction", next.direction);
  const value = params.toString();
  return value ? `/admin/${resource}/?${value}` : `/admin/${resource}/`;
}
