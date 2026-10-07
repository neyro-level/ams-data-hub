import { randomUUID } from "node:crypto";
import { createUlid } from "@ams-data-hub/data-contracts";
import { describe, expect, it } from "vitest";
import { agentCommands, feedAgentMatchingCommands } from "../../src/modules/project-state/server.ts";
import { sourceRegistryCommands } from "../../src/modules/ingestion-core/server.ts";
import { createProjectJobPrincipal } from "../../src/platform/authorization/principal-factories.ts";
import type { PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";
import { runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";
import { analyzeImportSafety, BOOTSTRAP_SOURCE_SAFETY_POLICY } from "../../src/modules/ingestion-core/index.ts";

function admin(): PlatformAdminPrincipal {
  return { kind: "platform-admin", userId: `matching-admin-${randomUUID()}`, correlationId: randomUUID() };
}

describe("agent source evidence and guarded matching", () => {
  it("deduplicates safe matches, reviews collisions, excludes shared phones and never infers departure", async () => {
    const principal = admin();
    const suffix = randomUUID().slice(0, 8);
    const scope = await runInPrincipalDatabaseTransaction(principal, async (transaction) => {
      const organization = await transaction.organization.create({ data: { name: `Matching Org ${suffix}`, slug: `matching-org-${suffix}` } });
      const project = await transaction.project.create({ data: { organizationId: organization.id, name: `Matching Project ${suffix}`, slug: `matching-project-${suffix}` } });
      return { organizationId: organization.id, projectId: project.id };
    });
    const credential = `SYNTHETIC_MATCHING_ENDPOINT_${suffix.toUpperCase()}`;
    process.env[credential] = "https://feed.example.invalid/synthetic.xml";
    try {
      const source = await sourceRegistryCommands.createSource(principal, {
        ...scope,
        sourceKey: `matching-${suffix}`,
        name: "Synthetic matching source",
        endpointCredentialRef: credential,
        adapterKey: "yrl-realty-2010",
        adapterVersion: "1.0.0",
        profileKey: "vladis-vt24-v1",
        profileVersion: "1.0.0",
        datasetType: "MIXED_REALTY",
        transportType: "HTTPS_XML",
        sharingPolicy: "PROJECT_ONLY",
        schedulePolicy: { mode: "MANUAL_ONLY" },
        safetyPolicyId: "",
        expectedNamespace: "",
        expectedProducer: "",
      });
      const revisions = await runInPrincipalDatabaseTransaction(principal, async (tx) => {
        await tx.dataSafetyState.upsert({ where: { id: "global" }, create: { id: "global", jobsFrozen: false, unfrozenAt: new Date() },
          update: { jobsFrozen: false, unfrozenAt: new Date() } });
        const producer = await tx.source.findUniqueOrThrow({ where: { id: source.sourceId } });
        const target = { ...scope, sourceId: producer.id };
        const uids = new Map(Array.from({ length: 5 }, (_, index) => [`offer-${index + 1}`, createUlid()]));
        for (const [externalOfferId, uid] of uids) await tx.inventoryIdentity.create({ data: { ...target, uid, externalOfferId,
          firstSeenAt: new Date(), lastSeenAt: new Date(), sourceHash: "a".repeat(64), normalizedHash: "b".repeat(64) } });
        const ids: string[] = []; let previousCount: number | null = null;
        const policy = { ...BOOTSTRAP_SOURCE_SAFETY_POLICY, maxDropPercent: 100, requireManualApprovalAboveDrop: false };
        for (const offers of [["offer-1", "offer-2", "offer-3", "offer-4"], ["offer-5"], ["offer-5"], ["offer-5"]]) {
          const revision = await tx.sourceRevision.create({ data: { ...target, sourceVersion: producer.version,
            adapterKey: producer.adapterKey, adapterVersion: producer.adapterVersion, profileKey: producer.profileKey,
            profileVersion: producer.profileVersion, baseLastGoodRevisionId: ids.at(-1) ?? null,
            recordCount: offers.length, safetyPolicy: policy, safetyAnalysis: JSON.parse(JSON.stringify(analyzeImportSafety({
              recordCount: offers.length, previousGoodRecordCount: previousCount, invalidRecordCount: 0, issues: [],
            }, policy))) } });
          await tx.sourceRevisionRecord.createMany({ data: offers.map((externalId) => ({ ...target, revisionId: revision.id,
            externalId, orderKey: Buffer.from(externalId).toString("hex"), inventoryUid: uids.get(externalId)!,
            recordHash: "b".repeat(64), payload: { schemaVersion: 1, draft: { externalId }, fields: {} } })) });
          await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "STAGED", sequence: ids.length + 1,
            rawStorageKey: "synthetic-matching", rawArtifactHash: "a".repeat(64), rawByteCount: 1,
            normalizedContentHash: "b".repeat(64), completedAt: new Date() } });
          await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "GOOD" } });
          ids.push(revision.id); previousCount = offers.length;
        }
        await tx.source.update({ where: { id: producer.id }, data: { lastGoodRevisionId: ids.at(-1)! } });
        return ids;
      });
      const job = createProjectJobPrincipal({ jobName: "agent-matching", ...scope });
      const observedAt = new Date("2026-10-05T00:00:00.000Z").toISOString();
      const first = await feedAgentMatchingCommands.reconcileFeedAgents(job, {
        ...scope,
        sourceId: source.sourceId,
        sourceRevisionId: revisions[0]!,
        observedAt,
        sharedOfficePhones: ["+79590000099"],
        evidence: [
          { fullNameRaw: "Анна Агент", phoneRaw: "+7 959 000-00-01", offerExternalIds: ["offer-1"] },
          { fullNameRaw: " АННА  Агент ", phoneRaw: "+79590000001", photoSourceUrl: "https://media.example.invalid/new.jpg", offerExternalIds: ["offer-2"] },
          { fullNameRaw: "Офис Один", phoneRaw: "+79590000099", offerExternalIds: ["offer-3"] },
          { fullNameRaw: "Офис Два", phoneRaw: "+79590000099", offerExternalIds: ["offer-4"] },
        ],
      });
      expect(first.bindings).toHaveLength(3);
      const createdBinding = first.bindings.find((binding) => binding.outcome === "CREATED");
      expect(createdBinding?.offerExternalIds).toEqual(["offer-1", "offer-2"]);
      expect(first.bindings.filter((binding) => binding.outcome === "SHARED_OFFICE")).toHaveLength(2);

      const stateAfterFirst = await runInPrincipalDatabaseTransaction(principal, async (transaction) => ({
        agents: await transaction.agent.findMany({ where: scope }),
        evidence: await transaction.agentSourceEvidence.findMany({ where: { ...scope, sourceId: source.sourceId } }),
      }));
      expect(stateAfterFirst.agents).toHaveLength(1);
      expect(stateAfterFirst.evidence).toHaveLength(3);
      expect(stateAfterFirst.evidence.find((item) => item.agentUid)?.photoSourceUrl).toBe("https://media.example.invalid/new.jpg");
      expect(stateAfterFirst.agents[0]).toMatchObject({ origin: "FEED", status: "ACTIVE", listingPresenceStatus: "HAS_ACTIVE_LISTINGS" });
      const agentUid = stateAfterFirst.agents[0]!.uid;

      const repeated = await feedAgentMatchingCommands.reconcileFeedAgents(job, {
        ...scope,
        sourceId: source.sourceId,
        sourceRevisionId: revisions[1]!,
        observedAt: new Date("2026-10-05T01:00:00.000Z").toISOString(),
        sharedOfficePhones: ["+79590000099"],
        evidence: [{ fullNameRaw: "Анна Агент", phoneRaw: "+79590000001", photoSourceUrl: "https://media.example.invalid/changed.jpg", offerExternalIds: ["offer-5"] }],
      });
      expect(repeated.bindings).toEqual([expect.objectContaining({ agentUid, outcome: "BOUND" })]);

      await feedAgentMatchingCommands.reconcileFeedAgents(job, {
        ...scope,
        sourceId: source.sourceId,
        sourceRevisionId: revisions[2]!,
        observedAt: new Date("2026-10-05T02:00:00.000Z").toISOString(),
        sharedOfficePhones: ["+79590000099"],
        evidence: [{ fullNameRaw: "Другое Имя", phoneRaw: "+79590000001", offerExternalIds: ["offer-5"] }],
      });
      const collision = await runInPrincipalDatabaseTransaction(principal, async (transaction) => ({
        count: await transaction.agent.count({ where: scope }),
        reviews: await transaction.agentMatchReview.findMany({ where: { ...scope, status: "PENDING" } }),
        agent: await transaction.agent.findUniqueOrThrow({ where: { uid: agentUid } }),
        merges: await transaction.agentMergeEvent.count({ where: scope }),
      }));
      expect(collision.count).toBe(1);
      expect(collision.reviews).toHaveLength(1);
      expect(collision.merges).toBe(0);
      expect(collision.agent).toMatchObject({ status: "ACTIVE", listingPresenceStatus: "NO_ACTIVE_LISTINGS" });

      const manual = await agentCommands.saveManualAgent(principal, {
        ...scope,
        version: 0,
        origin: "MANUAL",
        slug: `manual-${suffix}`,
        role: "MANAGER",
        fullName: "Ручной Агент",
        position: "Руководитель",
        bio: "Ручное описание",
        specializations: ["Переговоры"],
        photoMediaId: null,
        workPhone: "+79590000077",
        workEmail: "manual@example.test",
        messengers: [],
        showOnSite: true,
        sortOrder: 7,
        status: "ACTIVE",
        listingPresenceStatus: "UNKNOWN",
      });
      await feedAgentMatchingCommands.reconcileFeedAgents(job, {
        ...scope,
        sourceId: source.sourceId,
        sourceRevisionId: revisions[3]!,
        observedAt: new Date("2026-10-05T03:00:00.000Z").toISOString(),
        sharedOfficePhones: ["+79590000099"],
        evidence: [],
      });
      const final = await runInPrincipalDatabaseTransaction(principal, (transaction) => transaction.agent.findUniqueOrThrow({ where: { uid: manual.uid } }));
      expect(final).toMatchObject({
        origin: "MANUAL",
        role: "MANAGER",
        position: "Руководитель",
        bio: "Ручное описание",
        showOnSite: true,
        sortOrder: 7,
        status: "ACTIVE",
        listingPresenceStatus: "UNKNOWN",
      });
    } finally {
      delete process.env[credential];
    }
  });
});
