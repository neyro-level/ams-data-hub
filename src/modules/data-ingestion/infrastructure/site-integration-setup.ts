import { randomUUID } from "node:crypto";
import { createTopvisorClient, normalizeTopvisorCompetitors, readTopvisorEnvironment, TopvisorSafeError, type TopvisorDevice, type TopvisorEngine } from "../../../../collector/sources/topvisor/client.ts";
import { createMetricaClient, readMetricaEnvironment } from "../../../../collector/sources/yandex-metrica/client.ts";
import { createWebmasterClient, readWebmasterEnvironment } from "../../../../collector/sources/yandex-webmaster/client.ts";
import { Prisma } from "../../../generated/prisma/client.ts";
import { getPrismaClient } from "../../../platform/database/prisma/client.ts";

type SetupArgs = { organizationId: string; siteId: string; correlationId: string; env?: NodeJS.ProcessEnv };
const goalKeywords = {
  LEAD_SUBMIT: /заяв|отправ|форм|lead|submit/i,
  PHONE_CLICK: /телефон|номер|phone|call|звон/i,
} as const;

function safeCode(error: unknown) { return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "PROVIDER_SETUP_FAILED"; }
async function notify(args: { organizationId: string; projectId: string; siteId: string; category?: "INTEGRATION" | "REPORT" | "RANKING" | "COMPETITOR"; severity: "SUCCESS" | "WARNING" | "ERROR" | "INFO"; title: string; message: string; sourceType: string; sourceId?: string; dedupKey: string; adminOnly?: boolean }) {
  await getPrismaClient().notification.upsert({ where: { dedupKey: args.dedupKey }, update: { severity: args.severity, title: args.title, message: args.message, occurredAt: new Date() }, create: { organizationId: args.organizationId, projectId: args.projectId, siteId: args.siteId, category: args.category ?? "INTEGRATION", severity: args.severity, visibility: args.adminOnly ? "PLATFORM_ADMIN_ONLY" : "PLATFORM_TEAM", title: args.title, message: args.message, route: `/admin/sites/?site=${args.siteId}`, sourceType: args.sourceType, sourceId: args.sourceId, dedupKey: args.dedupKey, occurredAt: new Date() } });
}
async function setConnection(siteId: string, provider: "YANDEX_METRIKA" | "YANDEX_WEBMASTER" | "TOPVISOR", data: { status: "CONNECTING" | "CONNECTED" | "ACTION_REQUIRED" | "FAILED"; statusCode?: string | null; externalId?: string; settingsJson?: Prisma.InputJsonValue }) {
  await getPrismaClient().providerConnection.update({ where: { siteId_provider: { siteId, provider } }, data: { ...data, lastCheckedAt: new Date(), connectedAt: data.status === "CONNECTED" ? new Date() : undefined } });
}

async function setupMetrica(site: { id: string; organizationId: string; projectId: string; url: string }, env: NodeJS.ProcessEnv) {
  await setConnection(site.id, "YANDEX_METRIKA", { status: "CONNECTING" });
  try {
    const client = createMetricaClient(readMetricaEnvironment({ ...env, YANDEX_METRIKA_SITE_URL: site.url })); const result = await client.preflight();
    const suggestions = (Object.entries(goalKeywords) as Array<[keyof typeof goalKeywords, RegExp]>).map(([category, pattern]) => ({ category, candidates: result.goals.filter((goal) => pattern.test(goal.name)).map((goal) => ({ goalId: goal.goalId, name: goal.name })) }));
    const complete = suggestions.every((item) => item.candidates.length === 1);
    await setConnection(site.id, "YANDEX_METRIKA", { status: "ACTION_REQUIRED", statusCode: complete ? "GOAL_CONFIRMATION_REQUIRED" : "GOAL_MAPPING_REQUIRED", externalId: result.access.counterId, settingsJson: { counterName: result.access.name, permission: result.access.permission, goalSuggestions: suggestions } });
    await notify({ organizationId: site.organizationId, projectId: site.projectId, siteId: site.id, severity: "WARNING", title: "Метрика найдена — подтвердите цели", message: complete ? "Найдены предложения для заявки и раскрытия телефона. Подтвердите соответствия." : "Не удалось однозначно определить обе цели. Выберите их вручную.", sourceType: "ProviderConnection", dedupKey: `metrica-goals:${site.id}` });
  } catch (error) {
    const code = safeCode(error); await setConnection(site.id, "YANDEX_METRIKA", { status: "FAILED", statusCode: code }); await notify({ organizationId: site.organizationId, projectId: site.projectId, siteId: site.id, severity: "ERROR", title: "Метрика не подключена", message: `Проверьте доступ к счётчику. Код: ${code}`, sourceType: "ProviderConnection", dedupKey: `metrica-failed:${site.id}:${code}` });
  }
}

async function setupWebmaster(site: { id: string; organizationId: string; projectId: string; url: string }, env: NodeJS.ProcessEnv) {
  await setConnection(site.id, "YANDEX_WEBMASTER", { status: "CONNECTING" });
  try {
    const client = createWebmasterClient(readWebmasterEnvironment({ ...env, YANDEX_WEBMASTER_SITE_URL: site.url })); const access = await client.preflight();
    await setConnection(site.id, "YANDEX_WEBMASTER", { status: "CONNECTED", statusCode: null, externalId: access.hostId, settingsJson: { matchedHostUrl: access.matchedHostUrl } });
    await notify({ organizationId: site.organizationId, projectId: site.projectId, siteId: site.id, severity: "SUCCESS", title: "Вебмастер подключён", message: "Подтверждённый host найден, ежедневный сбор доступен.", sourceType: "ProviderConnection", dedupKey: `webmaster-connected:${site.id}` });
  } catch (error) {
    const code = safeCode(error); await setConnection(site.id, "YANDEX_WEBMASTER", { status: "FAILED", statusCode: code }); await notify({ organizationId: site.organizationId, projectId: site.projectId, siteId: site.id, severity: "ERROR", title: "Вебмастер не подключён", message: `Проверьте подтверждение сайта и доступ. Код: ${code}`, sourceType: "ProviderConnection", dedupKey: `webmaster-failed:${site.id}:${code}` });
  }
}

async function enqueueFollowup(args: SetupArgs, topic: string, key: string, payload: Record<string, string>, delayMinutes: number) {
  const prisma = getPrismaClient();
  const existing = await prisma.idempotencyKey.findUnique({ where: { scope_organizationScope_key: { scope: topic, organizationScope: args.organizationId, key } }, select: { id: true } }); if (existing) return;
  await prisma.$transaction(async (tx) => { const event = await tx.outboxEvent.create({ data: { organizationId: args.organizationId, topic, payload, correlationId: args.correlationId, availableAt: new Date(Date.now() + delayMinutes * 60_000) }, select: { id: true } }); await tx.idempotencyKey.create({ data: { organizationId: args.organizationId, organizationScope: args.organizationId, scope: topic, key, requestHash: key, status: "COMPLETED", response: { outboxEventId: event.id }, outboxEventId: event.id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } }); });
}

async function setupTopvisor(site: { id: string; organizationId: string; projectId: string; url: string; name: string; project: { slug: string } ; searchTargets: Array<{ id: string; engine: TopvisorEngine; device: TopvisorDevice; regionKey: string }>; trackedQuerySet: { queries: Array<{ query: string }> } | null }, args: SetupArgs, env: NodeJS.ProcessEnv) {
  await setConnection(site.id, "TOPVISOR", { status: "CONNECTING" });
  try {
    const client = createTopvisorClient(readTopvisorEnvironment(env)); const project = await client.findProjectByUrl(site.url); const projectId = project?.id ?? await client.createProject(site.url, site.name);
    let configured = await client.getConfiguredTargets(projectId);
    for (const engine of ["YANDEX", "GOOGLE"] as const) {
      if (!configured.some((item) => item.engine === engine)) await client.addSearcher(projectId, engine);
      for (const device of ["DESKTOP", "MOBILE"] as const) {
        const target = site.searchTargets.find((item) => item.engine === engine && item.device === device);
        if (!target) throw new TopvisorSafeError("TOPVISOR_TARGET_MISSING", null, "Search target is missing");
        const exists = configured.some((item) => item.engine === engine && item.device === device && String(item.regionKey) === target.regionKey);
        if (!exists) await client.addRegion(projectId, engine, device, Number(target.regionKey));
      }
    }
    const queries = site.trackedQuerySet?.queries.map((item) => item.query) ?? []; await client.importMissingKeywords(projectId, queries);
    configured = await client.getConfiguredTargets(projectId);
    for (const target of site.searchTargets) { const match = configured.find((item) => item.engine === target.engine && item.device === target.device && String(item.regionKey) === target.regionKey); if (match) await getPrismaClient().searchTarget.update({ where: { id: target.id }, data: { regionIndex: match.regionIndex } }); }
    if (configured.length < 4) throw new TopvisorSafeError("TOPVISOR_TARGETS_INCOMPLETE", null, "Four search targets are required");
    const operationKey = `topvisor:first-rank:${site.id}`; const prior = await getPrismaClient().providerOperation.findUnique({ where: { operationKey } });
    if (!prior) {
      const indexes = [...new Set(configured.map((item) => item.regionIndex))]; const price = await client.getCheckerPrice(projectId, indexes);
      await getPrismaClient().providerOperation.create({ data: { organizationId: site.organizationId, siteId: site.id, provider: "TOPVISOR", operation: "RANK_CHECK", operationKey, status: "PENDING", externalId: String(projectId), price, currency: "RUB" } });
      const reserved = await getPrismaClient().providerOperation.updateMany({ where: { operationKey, status: "PENDING" }, data: { status: "DISPATCHING", startedAt: new Date() } });
      if (reserved.count !== 1) throw new TopvisorSafeError("TOPVISOR_OPERATION_ALREADY_CLAIMED", null, "Paid operation already claimed");
      try { await client.startChecker(projectId, indexes); await getPrismaClient().providerOperation.update({ where: { operationKey }, data: { status: "STARTED" } }); }
      catch (error) { await getPrismaClient().providerOperation.update({ where: { operationKey }, data: { status: "ACTION_REQUIRED", safeErrorCode: safeCode(error) } }); throw error; }
    } else if (prior.status === "DISPATCHING" || prior.status === "ACTION_REQUIRED") throw new TopvisorSafeError("TOPVISOR_PAID_RUN_REQUIRES_CHECK", null, "Paid operation result is ambiguous");
    const primaryTarget = configured.find((item) => item.engine === "YANDEX" && item.device === "DESKTOP") ?? configured[0];
    await setConnection(site.id, "TOPVISOR", { status: "CONNECTED", statusCode: null, externalId: String(projectId), settingsJson: { projectId, regionIndex: primaryTarget?.regionIndex, targets: configured } });
    await notify({ organizationId: site.organizationId, projectId: site.projectId, siteId: site.id, severity: "SUCCESS", title: "Topvisor настроен", message: "Проект, ядро и четыре цели проверки готовы; первый съём запущен.", sourceType: "ProviderConnection", dedupKey: `topvisor-connected:${site.id}` });
    await enqueueFollowup(args, "project.sync.requested", `first-sync:${site.id}`, { projectSlug: site.project.slug, trigger: "backfill" }, 15);
    await enqueueFollowup(args, "site.competitors.sync.requested", `first-competitors:${site.id}`, { siteId: site.id }, 20);
  } catch (error) {
    const code = safeCode(error); const attention = code.includes("PRICE") || code.includes("REQUIRES_CHECK") || code.includes("INCOMPLETE"); await setConnection(site.id, "TOPVISOR", { status: attention ? "ACTION_REQUIRED" : "FAILED", statusCode: code }); await notify({ organizationId: site.organizationId, projectId: site.projectId, siteId: site.id, severity: attention ? "WARNING" : "ERROR", title: attention ? "Topvisor требует проверки" : "Topvisor не подключён", message: `Автоматическая настройка остановлена безопасно. Код: ${code}`, sourceType: "ProviderConnection", dedupKey: `topvisor-setup:${site.id}:${code}`, adminOnly: true });
  }
}

export async function setupSiteIntegrations(args: SetupArgs) {
  const site = await getPrismaClient().site.findFirst({ where: { id: args.siteId, organizationId: args.organizationId }, select: { id: true, organizationId: true, projectId: true, url: true, name: true, project: { select: { slug: true } }, searchTargets: { where: { enabled: true }, select: { id: true, engine: true, device: true, regionKey: true } }, trackedQuerySet: { select: { queries: { where: { enabled: true }, select: { query: true } } } } } });
  if (!site) throw Object.assign(new Error("Site setup scope is invalid"), { code: "SITE_SETUP_INVALID_SCOPE", retryable: false });
  const env = args.env ?? process.env; await Promise.all([setupMetrica(site, env), setupWebmaster(site, env)]); await setupTopvisor(site, args, env);
}

export async function syncSiteCompetitors(args: SetupArgs) {
  const site = await getPrismaClient().site.findFirst({ where: { id: args.siteId, organizationId: args.organizationId }, select: { id: true, organizationId: true, projectId: true, name: true, providerConnections: { where: { provider: "TOPVISOR", enabled: true }, select: { externalId: true } }, searchTargets: { where: { enabled: true, regionIndex: { not: null } }, select: { engine: true, device: true, regionKey: true, regionName: true, regionIndex: true } } } });
  if (!site) throw Object.assign(new Error("Competitor scope is invalid"), { code: "COMPETITOR_SYNC_INVALID_SCOPE", retryable: false });
  const projectId = Number(site.providerConnections[0]?.externalId); if (!Number.isSafeInteger(projectId) || projectId <= 0) throw Object.assign(new Error("Topvisor mapping is missing"), { code: "TOPVISOR_SITE_NOT_CONFIGURED", retryable: false });
  const client = createTopvisorClient(readTopvisorEnvironment(args.env ?? process.env)); const capturedAt = new Date(); const date = capturedAt.toISOString().slice(0, 10);
  let stored = 0;
  for (const target of site.searchTargets) {
    const payload = await client.collectCompetitors(projectId, target.regionIndex!, date, date); const rows = normalizeTopvisorCompetitors(payload);
    if (rows.length) { await getPrismaClient().competitorSnapshot.createMany({ data: rows.map((row) => ({ organizationId: site.organizationId, siteId: site.id, capturedAt, engine: target.engine, device: target.device, regionKey: target.regionKey, regionName: target.regionName, domain: row.domain, visibility: row.visibility, averagePosition: row.averagePosition, top3: row.top3, top10: row.top10, top30: row.top30, top50: row.top50, top100: row.top100, queryCount: row.queryCount })), skipDuplicates: true }); stored += rows.length; }
  }
  await notify({ organizationId: site.organizationId, projectId: site.projectId, siteId: site.id, category: "COMPETITOR", severity: stored ? "SUCCESS" : "WARNING", title: stored ? "Отчёт по конкурентам готов" : "Конкуренты пока не найдены", message: stored ? `Сохранено ${stored} строк по Яндексу, Google и устройствам.` : "Topvisor не вернул данные снимков для выбранного ядра.", sourceType: "CompetitorSnapshot", dedupKey: `competitors:${site.id}:${date}` });
}

export async function syncAllConfiguredCompetitors(env: NodeJS.ProcessEnv = process.env) {
  const sites = await getPrismaClient().site.findMany({ where: { enabled: true, providerConnections: { some: { provider: "TOPVISOR", enabled: true, status: "CONNECTED" } } }, select: { id: true, organizationId: true } });
  const results: Array<{ siteId: string; ok: boolean; code: string | null }> = [];
  for (const site of sites) { try { await syncSiteCompetitors({ organizationId: site.organizationId, siteId: site.id, correlationId: randomUUID(), env }); results.push({ siteId: site.id, ok: true, code: null }); } catch (error) { results.push({ siteId: site.id, ok: false, code: safeCode(error) }); } }
  return results;
}

export async function startScheduledTopvisorChecks(env: NodeJS.ProcessEnv = process.env, now = new Date()) {
  const sites = await getPrismaClient().site.findMany({
    where: { enabled: true, providerConnections: { some: { provider: "TOPVISOR", enabled: true, status: "CONNECTED" } } },
    select: {
      id: true,
      organizationId: true,
      projectId: true,
      providerConnections: { where: { provider: "TOPVISOR", enabled: true, status: "CONNECTED" }, select: { externalId: true } },
      searchTargets: { where: { enabled: true, regionIndex: { not: null } }, select: { regionIndex: true } },
    },
  });
  const date = now.toISOString().slice(0, 10);
  const client = createTopvisorClient(readTopvisorEnvironment(env));
  const results: Array<{ siteId: string; ok: boolean; code: string | null; skipped: boolean }> = [];

  for (const site of sites) {
    const operationKey = `topvisor:weekly-rank:${site.id}:${date}`;
    try {
      const projectId = Number(site.providerConnections[0]?.externalId);
      const indexes = [...new Set(site.searchTargets.map((target) => target.regionIndex).filter((value): value is number => value !== null))];
      if (!Number.isSafeInteger(projectId) || projectId <= 0 || site.searchTargets.length !== 4 || indexes.length === 0) {
        throw new TopvisorSafeError("TOPVISOR_TARGETS_INCOMPLETE", null, "Four configured search targets are required");
      }
      const prior = await getPrismaClient().providerOperation.findUnique({ where: { operationKey } });
      if (prior) {
        results.push({ siteId: site.id, ok: prior.status === "STARTED" || prior.status === "COMPLETED", code: prior.safeErrorCode, skipped: true });
        continue;
      }
      const price = await client.getCheckerPrice(projectId, indexes);
      await getPrismaClient().providerOperation.create({ data: { organizationId: site.organizationId, siteId: site.id, provider: "TOPVISOR", operation: "RANK_CHECK", operationKey, status: "PENDING", externalId: String(projectId), price, currency: "RUB" } });
      const reserved = await getPrismaClient().providerOperation.updateMany({ where: { operationKey, status: "PENDING" }, data: { status: "DISPATCHING", startedAt: now } });
      if (reserved.count !== 1) throw new TopvisorSafeError("TOPVISOR_OPERATION_ALREADY_CLAIMED", null, "Paid operation already claimed");
      try {
        await client.startChecker(projectId, indexes);
        await getPrismaClient().providerOperation.update({ where: { operationKey }, data: { status: "STARTED" } });
        await notify({ organizationId: site.organizationId, projectId: site.projectId, siteId: site.id, category: "RANKING", severity: "INFO", title: "Недельная проверка позиций запущена", message: "Topvisor проверяет Яндекс и Google для desktop и mobile.", sourceType: "ProviderOperation", sourceId: operationKey, dedupKey: operationKey, adminOnly: true });
        results.push({ siteId: site.id, ok: true, code: null, skipped: false });
      } catch (error) {
        const code = safeCode(error);
        await getPrismaClient().providerOperation.update({ where: { operationKey }, data: { status: "ACTION_REQUIRED", safeErrorCode: code } });
        throw error;
      }
    } catch (error) {
      const code = safeCode(error);
      await notify({ organizationId: site.organizationId, projectId: site.projectId, siteId: site.id, category: "RANKING", severity: "ERROR", title: "Проверка позиций не запущена", message: `Платная операция остановлена безопасно. Код: ${code}`, sourceType: "ProviderOperation", sourceId: operationKey, dedupKey: `${operationKey}:${code}`, adminOnly: true });
      results.push({ siteId: site.id, ok: false, code, skipped: false });
    }
  }
  return results;
}
