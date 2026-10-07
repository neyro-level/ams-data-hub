import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import type {
  AgentEvidenceScope,
  AgentMatchingRepository,
} from "../application/ports/agent-matching-repository.ts";
import { normalizeAgentFullName, type NormalizedAgentEvidence } from "../domain/agent-matching.ts";
import { assertMutatingJobsAllowed, PrismaDataSafetyRepository } from "../../platform-operations/server.ts";

export class PrismaAgentMatchingRepository implements AgentMatchingRepository {
  constructor(private readonly transaction: DatabaseTransaction) {}

  async readGoodOffers(scope: AgentEvidenceScope, externalIds: readonly string[]) {
    const where = { organizationId: scope.organizationId, projectId: scope.projectId, sourceId: scope.sourceId };
    if (await this.transaction.sourceRevision.count({ where: { ...where, id: scope.sourceRevisionId, status: "GOOD" } }) !== 1) {
      throw new Error("AGENT_MATCHING_GOOD_FACT_INVALID");
    }
    const output: { externalId: string; inventoryUid: string; recordHash: string }[] = [];
    for (let offset = 0; offset < externalIds.length; offset += 200) {
      const page = externalIds.slice(offset, offset + 200);
      const rows = await this.transaction.sourceRevisionRecord.findMany({ where: { ...where,
        revisionId: scope.sourceRevisionId, externalId: { in: [...page] } }, take: 201,
      select: { externalId: true, inventoryUid: true, recordHash: true } });
      if (rows.length !== page.length) throw new Error("AGENT_MATCHING_GOOD_FACT_INVALID");
      output.push(...rows);
    }
    return output;
  }

  async replaceListingBindings(scope: AgentEvidenceScope,
    bindings: readonly { inventoryUid: string; recordHash: string; agentUid: string }[]) {
    const where = { organizationId: scope.organizationId, projectId: scope.projectId, sourceId: scope.sourceId,
      sourceRevisionId: scope.sourceRevisionId };
    await this.transaction.listingAgentBinding.deleteMany({ where });
    for (let offset = 0; offset < bindings.length; offset += 200) {
      await this.transaction.listingAgentBinding.createMany({ data: bindings.slice(offset, offset + 200)
        .map((binding) => ({ ...where, ...binding })) });
    }
  }

  async lockProject(organizationId: string, projectId: string): Promise<void> {
    await this.transaction.$queryRaw(Prisma.sql`select pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations', 0))::text`);
    await assertMutatingJobsAllowed(new PrismaDataSafetyRepository(this.transaction));
    await this.transaction.$executeRaw(Prisma.sql`
      select pg_advisory_xact_lock(hashtextextended(${`${organizationId}:${projectId}:agent-matching`}, 0))
    `);
  }

  async sourceExists(scope: Pick<AgentEvidenceScope, "organizationId" | "projectId" | "sourceId">): Promise<boolean> {
    return await this.transaction.source.count({
      where: { id: scope.sourceId, organizationId: scope.organizationId, projectId: scope.projectId },
    }) === 1;
  }

  async findCandidates(organizationId: string, projectId: string, phoneNorm: string) {
    const identities = await this.transaction.agentExternalIdentity.findMany({
      where: { organizationId, projectId, phoneNorm, sharedOfficePhone: false },
      include: { agent: true },
    });
    return identities.map(({ agent }) => ({
      agentUid: agent.uid,
      origin: agent.origin,
      fullName: agent.fullName,
      normalizedFullName: normalizeAgentFullName(agent.fullName),
    }));
  }

  async createFeedAgent(input: AgentEvidenceScope & NormalizedAgentEvidence & { agentUid: string; slug: string }): Promise<string> {
    const created = await this.transaction.agent.create({
      data: {
        uid: input.agentUid,
        organizationId: input.organizationId,
        projectId: input.projectId,
        slug: input.slug,
        origin: "FEED",
        fullName: input.fullNameRaw,
        workPhone: input.phoneNorm,
        listingPresenceStatus: "HAS_ACTIVE_LISTINGS",
      },
      select: { uid: true },
    });
    return created.uid;
  }

  async touchIdentity(input: AgentEvidenceScope & { agentUid: string; phoneNorm: string }): Promise<void> {
    const existing = await this.transaction.agentExternalIdentity.findFirst({
      where: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        sourceId: input.sourceId,
        agentUid: input.agentUid,
        phoneNorm: input.phoneNorm,
      },
      select: { id: true },
    });
    if (existing) {
      await this.transaction.agentExternalIdentity.update({
        where: { id: existing.id },
        data: { lastSeenAt: input.observedAt, version: { increment: 1 } },
      });
      return;
    }
    await this.transaction.agentExternalIdentity.create({
      data: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        sourceId: input.sourceId,
        agentUid: input.agentUid,
        phoneNorm: input.phoneNorm,
        firstSeenAt: input.observedAt,
        lastSeenAt: input.observedAt,
      },
    });
  }

  async upsertEvidence(input: AgentEvidenceScope & NormalizedAgentEvidence & { agentUid: string | null }): Promise<void> {
    const data = {
      agentUid: input.agentUid,
      fullNameRaw: input.fullNameRaw,
      normalizedFullName: input.normalizedFullName,
      phoneRaw: input.phoneRaw,
      phoneNorm: input.phoneNorm,
      photoSourceUrl: input.photoSourceUrl,
      categoryRaw: input.categoryRaw,
      lastSeenAt: input.observedAt,
      sourceRevisionId: input.sourceRevisionId,
    };
    await this.transaction.agentSourceEvidence.upsert({
      where: {
        organizationId_projectId_sourceId_evidenceKey: {
          organizationId: input.organizationId,
          projectId: input.projectId,
          sourceId: input.sourceId,
          evidenceKey: input.evidenceKey,
        },
      },
      create: {
        ...data,
        organizationId: input.organizationId,
        projectId: input.projectId,
        sourceId: input.sourceId,
        evidenceKey: input.evidenceKey,
        firstSeenAt: input.observedAt,
      },
      update: data,
    });
  }

  async ensureReview(input: AgentEvidenceScope & NormalizedAgentEvidence & { candidateAgentUid: string | null; reason: string }): Promise<void> {
    const existing = await this.transaction.agentMatchReview.findFirst({
      where: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        sourceId: input.sourceId,
        phoneNorm: input.phoneNorm,
        normalizedFullName: input.normalizedFullName,
        status: "PENDING",
      },
      select: { id: true },
    });
    if (existing) return;
    await this.transaction.agentMatchReview.create({
      data: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        sourceId: input.sourceId,
        candidateAgentUid: input.candidateAgentUid,
        normalizedFullName: input.normalizedFullName,
        phoneNorm: input.phoneNorm,
        reason: input.reason,
      },
    });
  }

  async reconcilePresence(scope: AgentEvidenceScope, activeAgentUids: readonly string[]) {
    const active = activeAgentUids.length === 0 ? { count: 0 } : await this.transaction.agent.updateMany({
      where: {
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        origin: "FEED",
        uid: { in: [...activeAgentUids] },
      },
      data: { listingPresenceStatus: "HAS_ACTIVE_LISTINGS", version: { increment: 1 } },
    });
    const inactive = await this.transaction.agent.updateMany({
      where: {
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        origin: "FEED",
        externalIdentities: { some: { sourceId: scope.sourceId } },
        ...(activeAgentUids.length > 0 ? { uid: { notIn: [...activeAgentUids] } } : {}),
      },
      data: { listingPresenceStatus: "NO_ACTIVE_LISTINGS", version: { increment: 1 } },
    });
    return { active: active.count, inactive: inactive.count };
  }
}
