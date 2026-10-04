import { randomUUID } from "node:crypto";
import { createUlid } from "@ams-data-hub/data-contracts";
import { describe, expect, it } from "vitest";
import { agentCommands, listAgentsForAdmin } from "../../src/modules/project-state/server.ts";
import type { JobPrincipal, PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";
import { runInPrincipalDatabaseTransaction, runInProjectPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";

function admin(): PlatformAdminPrincipal {
  return { kind: "platform-admin", userId: `agent-admin-${randomUUID()}`, correlationId: randomUUID() };
}

const manualInput = (scope: { organizationId: string; projectId: string }, values: { slug: string; fullName: string }) => ({
  ...scope,
  version: 0,
  origin: "MANUAL" as const,
  slug: values.slug,
  role: "AGENT" as const,
  fullName: values.fullName,
  position: "",
  bio: "",
  specializations: [],
  photoMediaId: null,
  workPhone: "",
  workEmail: "",
  messengers: [],
  showOnSite: false,
  sortOrder: 0,
  status: "ACTIVE" as const,
  listingPresenceStatus: "UNKNOWN" as const,
});

describe("agent project domain", () => {
  it("protects field ownership, audits manual changes and blocks suspicious bulk mutation", async () => {
    const principal = admin();
    const suffix = randomUUID().slice(0, 8);
    const scope = await runInPrincipalDatabaseTransaction(principal, async (transaction) => {
      const organization = await transaction.organization.create({ data: { name: `Agent Org ${suffix}`, slug: `agent-org-${suffix}` } });
      const project = await transaction.project.create({ data: { organizationId: organization.id, name: `Agent Project ${suffix}`, slug: `agent-project-${suffix}` } });
      return { organizationId: organization.id, projectId: project.id };
    });

    const first = await agentCommands.saveManualAgent(principal, manualInput(scope, { slug: `anna-${suffix}`, fullName: "Анна Агент" }));
    const second = await agentCommands.saveManualAgent(principal, manualInput(scope, { slug: `boris-${suffix}`, fullName: "Борис Агент" }));
    const third = await agentCommands.saveManualAgent(principal, manualInput(scope, { slug: `vera-${suffix}`, fullName: "Вера Агент" }));
    const fourth = await agentCommands.saveManualAgent(principal, manualInput(scope, { slug: `gleb-${suffix}`, fullName: "Глеб Агент" }));

    const feedUid = createUlid();
    await runInPrincipalDatabaseTransaction(principal, async (transaction) => {
      await transaction.agent.create({
        data: {
          uid: feedUid, organizationId: scope.organizationId, projectId: scope.projectId,
          slug: `feed-${suffix}`, origin: "FEED", fullName: "Имя из фида", workPhone: "+70000000000",
        },
      });
    });
    await expect(agentCommands.saveManualAgent(principal, {
      ...manualInput(scope, { slug: `feed-${suffix}`, fullName: "Подменённое имя" }),
      agentUid: feedUid, version: 1, origin: "FEED", workPhone: "+70000000000", role: "MANAGER",
    })).rejects.toThrow("AGENT_FEED_FIELD_OWNERSHIP_VIOLATION");
    const job: JobPrincipal = {
      kind: "job",
      jobName: "agent-fixture",
      organizationId: scope.organizationId,
      projectIds: [scope.projectId],
      correlationId: randomUUID(),
    };
    await runInProjectPrincipalDatabaseTransaction(job, scope.projectId, async (transaction) => {
      await transaction.agent.update({ where: { uid: feedUid }, data: { workPhone: "+71111111111", listingPresenceStatus: "HAS_ACTIVE_LISTINGS", version: { increment: 1 } } });
    });
    await expect(runInProjectPrincipalDatabaseTransaction(job, scope.projectId, (transaction) =>
      transaction.agent.update({ where: { uid: feedUid }, data: { role: "MANAGER", version: { increment: 1 } } }),
    )).rejects.toThrow(/manual-owned agent fields/i);
    await expect(runInProjectPrincipalDatabaseTransaction(job, scope.projectId, (transaction) =>
      transaction.agent.update({ where: { uid: first.uid }, data: { workPhone: "+72222222222", version: { increment: 1 } } }),
    )).rejects.toThrow(/manual-owned agent fields/i);

    const suspicious = await agentCommands.setAgentVisibilityBatch(principal, {
      ...scope, agentUids: [first.uid, second.uid], showOnSite: true,
    });
    expect(suspicious).toMatchObject({ state: "SUSPICIOUS", affected: 2, total: 5, thresholdPercent: 30 });
    const safe = await agentCommands.setAgentVisibilityBatch(principal, { ...scope, agentUids: [third.uid], showOnSite: true });
    expect(safe).toMatchObject({ state: "APPLIED", affected: 1, total: 5 });

    const suspiciousConsent = await agentCommands.confirmAgentConsentBatch(principal, {
      ...scope, agentUids: [first.uid, second.uid], confirmedBy: "Оператор проекта",
      confirmedAt: new Date(Date.now() - 60_000).toISOString(), basis: "Синтетическое подтверждение", referenceUrl: "", note: "", confirmSuspicious: false,
    });
    expect(suspiciousConsent).toMatchObject({ state: "SUSPICIOUS", affected: 2, total: 5, thresholdPercent: 30 });
    const confirmedSuspiciousConsent = await agentCommands.confirmAgentConsentBatch(principal, {
      ...scope, agentUids: [first.uid, second.uid], confirmedBy: "Оператор проекта",
      confirmedAt: new Date(Date.now() - 60_000).toISOString(), basis: "Подтверждённая массовая операция",
      referenceUrl: "", note: "", confirmSuspicious: true,
    });
    expect(confirmedSuspiciousConsent).toMatchObject({ state: "APPLIED", affected: 2, total: 5 });
    const consent = await agentCommands.confirmAgentConsentBatch(principal, {
      ...scope, agentUids: [third.uid], confirmedBy: "Оператор проекта",
      confirmedAt: new Date(Date.now() - 60_000).toISOString(), basis: "Синтетическое подтверждение",
      referenceUrl: "https://example.test/consent/fixture", note: "Тестовая запись", confirmSuspicious: false,
    });
    expect(consent).toMatchObject({ state: "APPLIED", affected: 1, total: 5 });

    const result = await listAgentsForAdmin(principal, [scope.projectId]);
    expect(result.agents.find((agent) => agent.uid === third.uid)?.showOnSite).toBe(true);
    expect(result.agents.find((agent) => agent.uid === third.uid)?.isPubliclyPublishable).toBe(true);
    expect(result.agents.find((agent) => agent.uid === first.uid)?.showOnSite).toBe(false);
    expect(result.agents.find((agent) => agent.uid === first.uid)?.isPubliclyPublishable).toBe(false);
    expect(result.agents.map((agent) => agent.uid)).toEqual(expect.arrayContaining([first.uid, second.uid, third.uid, fourth.uid, feedUid]));

    const audit = await runInPrincipalDatabaseTransaction(principal, (transaction) => transaction.auditEvent.findMany({
      where: { organizationId: scope.organizationId, entityType: "Agent" },
      orderBy: { createdAt: "asc" },
    }));
    expect(audit.some((entry) => entry.action === "agent.visibility-batch")).toBe(true);
    expect(audit.some((entry) => entry.action === "agent.consent-batch")).toBe(true);
    const batches = await runInPrincipalDatabaseTransaction(principal, (transaction) => transaction.agentConsentBatch.findMany({ where: scope }));
    expect(batches).toHaveLength(2);
    expect(batches).toEqual(expect.arrayContaining([
      expect.objectContaining({ agentCount: 2, basis: "Подтверждённая массовая операция" }),
      expect.objectContaining({ agentCount: 1, basis: "Синтетическое подтверждение" }),
    ]));
    expect(JSON.stringify(audit)).not.toContain("Анна Агент");
    expect(JSON.stringify(audit)).not.toContain("+70000000000");
  });

  it("versions merge, relink and split operations without crossing the project", async () => {
    const principal = admin();
    const suffix = randomUUID().slice(0, 8);
    const scope = await runInPrincipalDatabaseTransaction(principal, async (transaction) => {
      const organization = await transaction.organization.create({ data: { name: `Merge Org ${suffix}`, slug: `merge-org-${suffix}` } });
      const project = await transaction.project.create({ data: { organizationId: organization.id, name: `Merge Project ${suffix}`, slug: `merge-project-${suffix}` } });
      return { organizationId: organization.id, projectId: project.id };
    });
    const source = await agentCommands.saveManualAgent(principal, manualInput(scope, { slug: `source-${suffix}`, fullName: "Источник" }));
    const target = await agentCommands.saveManualAgent(principal, manualInput(scope, { slug: `target-${suffix}`, fullName: "Цель" }));
    const other = await agentCommands.saveManualAgent(principal, manualInput(scope, { slug: `other-${suffix}`, fullName: "Другой" }));
    const identities = await runInPrincipalDatabaseTransaction(principal, async (transaction) => Promise.all([
      transaction.agentExternalIdentity.create({ data: { ...scope, agentUid: source.uid, sourceId: "fixture", externalId: `one-${suffix}`, firstSeenAt: new Date(), lastSeenAt: new Date() } }),
      transaction.agentExternalIdentity.create({ data: { ...scope, agentUid: source.uid, sourceId: "fixture", externalId: `two-${suffix}`, firstSeenAt: new Date(), lastSeenAt: new Date() } }),
    ]));

    await expect(agentCommands.relinkAgentIdentity(principal, {
      ...scope, externalIdentityId: identities[0].id, sourceAgentUid: source.uid, targetAgentUid: other.uid, targetVersion: other.version,
    })).resolves.toEqual({ targetAgentUid: other.uid });
    const split = await agentCommands.splitAgentIdentity(principal, {
      ...scope, externalIdentityId: identities[1].id, sourceAgentUid: source.uid, sourceVersion: source.version,
      newAgentSlug: `split-${suffix}`, newAgentFullName: "Разделённый агент",
    });
    expect(split.origin).toBe("FEED");

    const refreshed = await listAgentsForAdmin(principal, [scope.projectId]);
    const sourceAfterSplit = refreshed.agents.find((agent) => agent.uid === source.uid)!;
    const targetAfterRelink = refreshed.agents.find((agent) => agent.uid === target.uid)!;
    const merged = await agentCommands.mergeAgents(principal, {
      ...scope, sourceAgentUid: source.uid, sourceVersion: sourceAfterSplit.version,
      targetAgentUid: target.uid, targetVersion: targetAfterRelink.version,
    });
    expect(merged.source).toMatchObject({ status: "HIDDEN", showOnSite: false });
    const events = await runInPrincipalDatabaseTransaction(principal, (transaction) => transaction.agentMergeEvent.findMany({ where: scope }));
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["RELINK", "SPLIT", "MERGE"]));
  });
});
