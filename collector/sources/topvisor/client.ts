import { z } from "zod";
import type { SiteRegistry } from "../../../src/shared/schemas/registry.ts";
import { requireTrustedApiBaseUrl } from "../trusted-api-url.ts";
import {
  topvisorSiteDataSchema,
  type RankSnapshot,
  type TopvisorSiteData,
} from "../../../src/shared/schemas/rank-source.ts";

export type TopvisorEnvironment = {
  baseUrl: string;
  userId: string;
  apiKey: string;
};

type FetchLike = typeof fetch;

type TopvisorCollectOptions = {
  dateFrom: string;
  dateTo: string;
};

export type TopvisorRegionCandidate = {
  key: number;
  name: string;
  countryCode: string;
  parentName: string | null;
};

export type TopvisorEngine = "YANDEX" | "GOOGLE";
export type TopvisorDevice = "DESKTOP" | "MOBILE";
export type TopvisorCompetitor = { domain: string; visibility: number | null; averagePosition: number | null; top3: number; top10: number; top30: number; top50: number; top100: number; queryCount: number };

const SEARCHER_KEY: Record<TopvisorEngine, number> = { YANDEX: 0, GOOGLE: 1 };
const DEVICE_KEY: Record<TopvisorDevice, number> = { DESKTOP: 0, MOBILE: 2 };

export class TopvisorSafeError extends Error {
  constructor(
    readonly code: string,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = "TopvisorSafeError";
  }
}

function requireEnvironment(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key]?.trim();
  if (!value) {
    throw new TopvisorSafeError("TOPVISOR_NOT_CONFIGURED", null, `Missing ${key}`);
  }
  return value;
}

export function readTopvisorEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): TopvisorEnvironment {
  const rawBaseUrl =
    env.TOPVISOR_API_BASE_URL?.trim() || "https://api.topvisor.com/v2/json";
  let baseUrl: string;
  try {
    baseUrl = requireTrustedApiBaseUrl(rawBaseUrl, {
      origin: "https://api.topvisor.com",
      pathname: "/v2/json",
    });
  } catch {
    throw new TopvisorSafeError(
      "UNTRUSTED_ORIGIN",
      null,
      "TOPVISOR_API_BASE_URL is not allowlisted",
    );
  }

  return {
    baseUrl,
    userId: requireEnvironment(env, "TOPVISOR_USER_ID"),
    apiKey: requireEnvironment(env, "TOPVISOR_API_KEY"),
  };
}

const topvisorObjectSchema = z.looseObject({});
type TopvisorObject = z.infer<typeof topvisorObjectSchema>;

function parseTopvisorObject(value: unknown): TopvisorObject | null {
  const parsed = topvisorObjectSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function unwrapResult(value: unknown) {
  const object = parseTopvisorObject(value);
  return object?.result !== undefined ? object.result : value;
}

function firstArray(value: unknown, keys: string[]): unknown[] {
  const source = unwrapResult(value);
  if (Array.isArray(source)) return source;
  const object = parseTopvisorObject(source);
  if (!object) return [];
  for (const key of keys) {
    const candidate = object[key];
    if (Array.isArray(candidate)) return candidate;
    if (parseTopvisorObject(candidate)) {
      const nested = firstArray(candidate, keys);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

function toPosition(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value >= 1 && value <= 250 ? Math.round(value) : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 1 && parsed <= 250
      ? Math.round(parsed)
      : null;
  }
  const object = parseTopvisorObject(value);
  if (object) {
    for (const key of ["position", "pos", "value"]) {
      const nested = toPosition(object[key]);
      if (nested !== null) return nested;
    }
  }
  return null;
}

function queryText(row: Record<string, unknown>) {
  for (const key of ["name", "keyword", "phrase", "query"]) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function extractDates(payload: unknown, dateFrom: string, dateTo: string) {
  const candidates = firstArray(payload, ["dates", "labels", "xAxis", "x_axis"])
    .map(String)
    .map((value) => value.slice(0, 10))
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
  const dates = [...new Set(candidates)].filter(
    (date) => date >= dateFrom && date <= dateTo,
  );
  return dates.length > 0 ? dates.slice(-30) : [dateTo];
}

export function normalizeTopvisorHistory(args: {
  payload: unknown;
  dates: string[];
  fetchedAt: string;
  projectId: number;
  regionIndex: number;
  target?: { engine: TopvisorEngine; device: TopvisorDevice; regionKey: number };
}): TopvisorSiteData {
  const snapshots = new Map<string, RankSnapshot>(
    args.dates.map((date) => [date, { capturedAt: date, queries: [], ...(args.target ? { engine: args.target.engine, device: args.target.device, regionKey: String(args.target.regionKey), regionIndex: args.regionIndex } : {}) }]),
  );
  const rows = firstArray(args.payload, ["rows", "items", "keywords", "data"]);

  for (const value of rows) {
    const row = parseTopvisorObject(value);
    if (!row) continue;
    const query = queryText(row);
    if (!query) continue;
    const positions = Array.isArray(row.positionsData)
      ? row.positionsData
      : Array.isArray(row.positions_data)
        ? row.positions_data
        : [];

    for (const [index, date] of args.dates.entries()) {
      const item = positions[index];
      const position = toPosition(item ?? (index === args.dates.length - 1 ? row.position : null));
      snapshots.get(date)?.queries.push({ query, position });
    }
  }

  return topvisorSiteDataSchema.parse({
    schemaVersion: args.target ? 2 : 1,
    fetchedAt: args.fetchedAt,
    projectId: args.projectId,
    regionIndex: args.regionIndex,
    snapshots: [...snapshots.values()].filter((snapshot) => snapshot.queries.length > 0),
  });
}

async function requestTopvisor(args: {
  environment: TopvisorEnvironment;
  service: string;
  method: string;
  body: Record<string, unknown>;
  fetchImpl: FetchLike;
  action?: "get" | "add" | "edit";
}) {
  const endpoint = `${args.environment.baseUrl.replace(/\/$/, "")}/${args.action ?? "get"}/${args.service}/${args.method}`;
  let response: Response;
  try {
    response = await args.fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Id": args.environment.userId,
        Authorization: `bearer ${args.environment.apiKey}`,
      },
      body: JSON.stringify(args.body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new TopvisorSafeError("TOPVISOR_NETWORK_ERROR", null, "Topvisor request failed");
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new TopvisorSafeError(
      response.status === 401 || response.status === 403
        ? "TOPVISOR_ACCESS_DENIED"
        : "TOPVISOR_HTTP_ERROR",
      response.status,
      `Topvisor returned HTTP ${response.status}`,
    );
  }
  const envelope = parseTopvisorObject(payload);
  if (envelope?.errors) {
    throw new TopvisorSafeError("TOPVISOR_API_ERROR", response.status, "Topvisor returned errors");
  }
  return payload;
}

function toPositiveInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function toNonNegativeInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function findPositiveId(value: unknown): number | null {
  const direct = toPositiveInteger(value);
  if (direct !== null) return direct;
  const object = parseTopvisorObject(unwrapResult(value));
  if (!object) return null;
  for (const key of ["id", "project_id", "projectId"]) {
    const candidate = toPositiveInteger(object[key]);
    if (candidate !== null) return candidate;
  }
  for (const nested of Object.values(object)) {
    const candidate = findPositiveId(nested);
    if (candidate !== null) return candidate;
  }
  return null;
}

export function normalizeTopvisorRegions(payload: unknown): TopvisorRegionCandidate[] {
  return firstArray(payload, ["regions", "items", "data"]).flatMap((value) => {
    const row = parseTopvisorObject(value);
    if (!row) return [];
    const key = toPositiveInteger(row.id ?? row.key ?? row.region_key);
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (key === null || !name) return [];
    const countryCode = typeof row.country_code === "string" ? row.country_code.toUpperCase() : "RU";
    const parentName = typeof row.parent_name === "string" ? row.parent_name : null;
    return [{ key, name, countryCode, parentName }];
  });
}

function normalizeProjectRows(payload: unknown) {
  return firstArray(payload, ["projects", "items", "data"]).flatMap((value) => {
    const row = parseTopvisorObject(value);
    if (!row) return [];
    const id = toPositiveInteger(row.id ?? row.project_id);
    const url = typeof row.url === "string" ? row.url : "";
    return id === null ? [] : [{ id, url, raw: row }];
  });
}

function normalizeKeywordNames(payload: unknown) {
  return new Set(firstArray(payload, ["keywords", "items", "data"]).flatMap((value) => {
    const row = parseTopvisorObject(value);
    const name = row && typeof row.name === "string" ? row.name : null;
    return name ? [name.toLocaleLowerCase("ru-RU").replace(/\s+/g, " ").trim()] : [];
  }));
}

function extractPrice(payload: unknown): number | null {
  const root = parseTopvisorObject(unwrapResult(payload));
  const grouped = root ? parseTopvisorObject(root.pricesByUsers) : null;
  if (!grouped) return null;
  for (const value of Object.values(grouped)) {
    const row = parseTopvisorObject(value);
    const price = row && (typeof row.price === "number" || typeof row.price === "string") ? Number(row.price) : Number.NaN;
    if (Number.isFinite(price) && price >= 0) return price;
  }
  return null;
}

function finiteNumber(value: unknown): number | null { const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN; return Number.isFinite(parsed) ? parsed : null; }
export function normalizeTopvisorCompetitors(payload: unknown): TopvisorCompetitor[] {
  const root = parseTopvisorObject(unwrapResult(payload)); const domainsValue = root?.domains; const domainsObject = parseTopvisorObject(domainsValue); const domains = Array.isArray(domainsValue) ? domainsValue : domainsObject ? Object.values(domainsObject) : [];
  const queryCount = Math.max(0, Math.round(finiteNumber(root?.countKeywords) ?? 0));
  return domains.flatMap((value) => { const row = parseTopvisorObject(value); const domain = row && typeof row.domain === "string" ? row.domain.trim() : ""; if (!row || !domain) return [];
    const summaries = parseTopvisorObject(row.summariesData); const summary = summaries ? parseTopvisorObject(Object.values(summaries).at(-1)) : null; const tops = parseTopvisorObject(summary?.tops);
    const top = (depth: number) => Math.max(0, Math.round(finiteNumber(tops?.[String(depth)]) ?? finiteNumber(tops?.[`top${depth}`]) ?? 0));
    return [{ domain, visibility: finiteNumber(summary?.visibility), averagePosition: finiteNumber(summary?.avg), top3: top(3), top10: top(10), top30: top(30), top50: top(50), top100: top(100), queryCount }];
  }).sort((left, right) => (right.visibility ?? 0) - (left.visibility ?? 0)).slice(0, 10);
}

function projectFilter(projectId: number) {
  return [{ name: "id", operator: "EQUALS", values: [String(projectId)] }];
}

function collectTargetIndexes(value: unknown, result: Array<{ engine: TopvisorEngine; device: TopvisorDevice; regionKey: number; regionIndex: number }> = []) {
  if (Array.isArray(value)) { for (const item of value) collectTargetIndexes(item, result); return result; }
  const row = parseTopvisorObject(value); if (!row) return result;
  const searcherKey = toPositiveInteger(row.searcher_key) ?? (row.searcher_key === 0 || row.searcher_key === "0" ? 0 : null);
  const regionKey = toPositiveInteger(row.region_key ?? row.key); const regionIndex = toNonNegativeInteger(row.index);
  const deviceValue = typeof row.device === "number" || typeof row.device === "string" ? Number(row.device) : typeof row.region_device === "number" || typeof row.region_device === "string" ? Number(row.region_device) : Number.NaN;
  if ((searcherKey === 0 || searcherKey === 1) && regionKey !== null && regionIndex !== null && (deviceValue === 0 || deviceValue === 2)) result.push({ engine: searcherKey === 0 ? "YANDEX" : "GOOGLE", device: deviceValue === 0 ? "DESKTOP" : "MOBILE", regionKey, regionIndex });
  for (const nested of Object.values(row)) if (typeof nested === "object" && nested !== null) collectTargetIndexes(nested, result);
  return result;
}

export function createTopvisorClient(
  environment: TopvisorEnvironment,
  fetchImpl: FetchLike = fetch,
) {
  return {
    async searchRegions(search: string, engine: TopvisorEngine) {
      const payload = await requestTopvisor({
        environment,
        service: "system_2",
        method: "common/regions",
        body: { searcher_key: SEARCHER_KEY[engine], search, country_code: "RU", limit: 20 },
        fetchImpl,
      });
      return normalizeTopvisorRegions(payload);
    },

    async findProjectByUrl(url: string) {
      const payload = await requestTopvisor({
        environment,
        service: "projects_2",
        method: "projects",
        body: { limit: 100, show_searchers_and_regions: 1 },
        fetchImpl,
      });
      const normalized = url.replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();
      return normalizeProjectRows(payload).find((project) => project.url.replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase() === normalized) ?? null;
    },

    async getConfiguredTargets(projectId: number) {
      const payload = await requestTopvisor({ environment, service: "projects_2", method: "projects", body: { filters: projectFilter(projectId), limit: 1, show_searchers_and_regions: 1 }, fetchImpl });
      return collectTargetIndexes(payload);
    },

    async createProject(url: string, name: string) {
      const payload = await requestTopvisor({ environment, service: "projects_2", method: "projects", body: { url, name }, fetchImpl, action: "add" });
      const projectId = findPositiveId(payload);
      if (projectId === null) throw new TopvisorSafeError("TOPVISOR_INVALID_RESPONSE", null, "Topvisor project id is missing");
      return projectId;
    },

    async addSearcher(projectId: number, engine: TopvisorEngine) {
      await requestTopvisor({ environment, service: "positions_2", method: "searchers", body: { project_id: projectId, searcher_key: SEARCHER_KEY[engine] }, fetchImpl, action: "add" });
    },

    async addRegion(projectId: number, engine: TopvisorEngine, device: TopvisorDevice, regionKey: number) {
      await requestTopvisor({ environment, service: "positions_2", method: "searchers_regions", body: { project_id: projectId, searcher_key: SEARCHER_KEY[engine], region_key: regionKey, region_device: DEVICE_KEY[device], region_depth: 1 }, fetchImpl, action: "add" });
    },

    async importMissingKeywords(projectId: number, queries: string[]) {
      const existingPayload = await requestTopvisor({ environment, service: "keywords_2", method: "keywords", body: { project_id: projectId, limit: 10_000 }, fetchImpl });
      const existing = normalizeKeywordNames(existingPayload);
      const missing = queries.filter((query) => !existing.has(query.toLocaleLowerCase("ru-RU").replace(/\s+/g, " ").trim()));
      if (missing.length === 0) return 0;
      const keywords = ["name", ...missing.map((query) => JSON.stringify(query))].join("\n");
      await requestTopvisor({ environment, service: "keywords_2", method: "keywords/import", body: { project_id: projectId, group_name: "Основное ядро", keywords }, fetchImpl, action: "add" });
      return missing.length;
    },

    async getCheckerPrice(projectId: number, regionIndexes?: number[]) {
      const payload = await requestTopvisor({ environment, service: "positions_2", method: "checker/price", body: { filters: projectFilter(projectId), regions_indexes: regionIndexes, do_snapshots: 1 }, fetchImpl });
      const price = extractPrice(payload);
      if (price === null) throw new TopvisorSafeError("TOPVISOR_PRICE_UNAVAILABLE", null, "Topvisor checker price is unavailable");
      return price;
    },

    async startChecker(projectId: number, regionIndexes?: number[]) {
      await requestTopvisor({ environment, service: "positions_2", method: "checker/go", body: { filters: projectFilter(projectId), regions_indexes: regionIndexes, do_snapshots: 1 }, fetchImpl, action: "edit" });
    },

    async collectCompetitors(projectId: number, regionIndex: number, dateFrom: string, dateTo: string) {
      return requestTopvisor({ environment, service: "snapshots_2", method: "competitors", body: { project_id: projectId, region_index: regionIndex, date1: dateFrom, date2: dateTo, type_range: 3 }, fetchImpl });
    },

    async collectSiteData(
      site: SiteRegistry,
      options: TopvisorCollectOptions,
    ): Promise<TopvisorSiteData> {
      const projectId = site.topvisor.projectId;
      const regionIndex = site.topvisor.regionIndex;
      if (projectId === null || regionIndex === null) {
        throw new TopvisorSafeError(
          "TOPVISOR_SITE_NOT_CONFIGURED",
          null,
          "Topvisor project mapping is missing",
        );
      }

      const targets = site.topvisor.targets?.length ? site.topvisor.targets : [{ engine: "YANDEX" as const, device: "DESKTOP" as const, regionKey: 0, regionIndex }];
      const snapshots: TopvisorSiteData["snapshots"] = [];
      for (const target of targets) {
      const chart = await requestTopvisor({
        environment,
        service: "positions_2",
        method: "summary/chart",
        body: {
          project_id: projectId,
          date1: options.dateFrom,
          date2: options.dateTo,
          show_tops: true,
          show_avg: true,
          show_visibility: true,
          region_index: target.regionIndex,
        },
        fetchImpl,
      });
      const dates = extractDates(chart, options.dateFrom, options.dateTo);
      const history = await requestTopvisor({
        environment,
        service: "positions_2",
        method: "history",
        body: {
          project_id: projectId,
          dates,
          positions_fields: ["position"],
          regions_indexes: [target.regionIndex + 1],
        },
        fetchImpl,
      });

      const normalized = normalizeTopvisorHistory({
        payload: history,
        dates,
        fetchedAt: new Date().toISOString(),
        projectId,
        regionIndex: target.regionIndex,
        target,
      });
      snapshots.push(...normalized.snapshots);
      }
      return topvisorSiteDataSchema.parse({ schemaVersion: targets.length > 1 ? 2 : 1, fetchedAt: new Date().toISOString(), projectId, regionIndex, snapshots });
    },
  };
}
