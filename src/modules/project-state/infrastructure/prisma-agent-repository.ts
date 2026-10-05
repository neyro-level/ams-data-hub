import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import type {
  AgentAdminItem,
  AgentMediaOption,
  ConfirmAgentConsentBatchInput,
  MergeAgentsInput,
  RelinkAgentIdentityInput,
  SaveManualAgentInput,
  SplitAgentIdentityInput,
} from "../contracts.ts";
import type { AgentAuditInput, AgentRepository } from "../application/ports/agent-repository.ts";
import { ProjectStateError } from "../domain/project-state-error.ts";
import { isAgentPubliclyPublishable } from "../domain/agent-publication.ts";

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toAgent(row: {
  uid: string; organizationId: string; projectId: string; slug: string;
  role: AgentAdminItem["role"]; origin: AgentAdminItem["origin"]; fullName: string;
  position: string | null; bio: string | null; specializations: string[];
  photoMediaId: string | null; workPhone: string | null; workEmail: string | null;
  messengers: unknown; showOnSite: boolean; sortOrder: number; status: AgentAdminItem["status"];
  listingPresenceStatus: AgentAdminItem["listingPresenceStatus"];
  consentConfirmedBy: string | null; consentConfirmedAt: Date | null; consentBasis: string | null;
  consentBatchId: string | null; version: number;
}): AgentAdminItem {
  return { ...row, messengers: stringArray(row.messengers), isPubliclyPublishable: isAgentPubliclyPublishable(row) };
}

function translateAgentWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") throw new ProjectStateError("AGENT_CONFLICT");
    if (error.code === "P2003") throw new ProjectStateError("AGENT_REFERENCE_INVALID");
  }
  throw error;
}

export class PrismaAgentRepository implements AgentRepository {
  constructor(private readonly transaction: DatabaseTransaction) {}

  async projectExists(organizationId: string, projectId: string): Promise<boolean> {
    return await this.transaction.project.count({ where: { organizationId, id: projectId } }) === 1;
  }

  async mediaBelongsToProject(organizationId: string, projectId: string, mediaId: string): Promise<boolean> {
    return await this.transaction.mediaAsset.count({ where: { id: mediaId, organizationId, projectId } }) === 1;
  }

  async findAgent(organizationId: string, projectId: string, agentUid: string): Promise<AgentAdminItem | null> {
    const row = await this.transaction.agent.findFirst({ where: { organizationId, projectId, uid: agentUid } });
    return row ? toAgent(row) : null;
  }

  async listAgents(projectIds: string[]): Promise<AgentAdminItem[]> {
    const rows = await this.transaction.agent.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: [{ projectId: "asc" }, { sortOrder: "asc" }, { fullName: "asc" }],
    });
    return rows.map(toAgent);
  }

  async listMedia(projectIds: string[]): Promise<AgentMediaOption[]> {
    return this.transaction.mediaAsset.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: { createdAt: "desc" },
      select: { id: true, projectId: true, originalFileName: true },
    });
  }

  async saveAgent(input: SaveManualAgentInput & { agentUid: string }): Promise<AgentAdminItem | null> {
    const data = {
      slug: input.slug,
      role: input.role,
      fullName: input.fullName,
      position: input.position || null,
      bio: input.bio || null,
      specializations: input.specializations,
      photoMediaId: input.photoMediaId,
      workPhone: input.workPhone || null,
      workEmail: input.workEmail || null,
      messengers: input.messengers,
      showOnSite: input.showOnSite,
      sortOrder: input.sortOrder,
      status: input.status,
      listingPresenceStatus: input.listingPresenceStatus,
    };
    try {
      if (input.version === 0) {
        const row = await this.transaction.agent.create({
          data: { ...data, uid: input.agentUid, organizationId: input.organizationId, projectId: input.projectId, origin: input.origin },
        });
        return toAgent(row);
      }
      const updated = await this.transaction.agent.updateMany({
        where: { organizationId: input.organizationId, projectId: input.projectId, uid: input.agentUid, version: input.version },
        data: { ...data, version: { increment: 1 } },
      });
      return updated.count === 1 ? this.findAgent(input.organizationId, input.projectId, input.agentUid) : null;
    } catch (error) {
      translateAgentWriteError(error);
    }
  }

  async countAgents(organizationId: string, projectId: string): Promise<number> {
    return this.transaction.agent.count({ where: { organizationId, projectId } });
  }

  async countAgentsByUids(organizationId: string, projectId: string, agentUids: string[]): Promise<number> {
    return this.transaction.agent.count({ where: { organizationId, projectId, uid: { in: agentUids } } });
  }

  async applyVisibility(organizationId: string, projectId: string, agentUids: string[], showOnSite: boolean): Promise<number> {
    const result = await this.transaction.agent.updateMany({
      where: { organizationId, projectId, uid: { in: agentUids } },
      data: { showOnSite, version: { increment: 1 } },
    });
    return result.count;
  }

  async confirmConsentBatch(
    input: ConfirmAgentConsentBatchInput,
    batchId: string,
    actorId: string,
    correlationId: string,
  ): Promise<number> {
    const confirmedAt = new Date(input.confirmedAt);
    await this.transaction.agentConsentBatch.create({
      data: {
        id: batchId,
        organizationId: input.organizationId,
        projectId: input.projectId,
        confirmedBy: input.confirmedBy,
        confirmedAt,
        basis: input.basis,
        referenceUrl: input.referenceUrl || null,
        note: input.note || null,
        actorId,
        correlationId,
        agentCount: input.agentUids.length,
      },
    });
    const result = await this.transaction.agent.updateMany({
      where: { organizationId: input.organizationId, projectId: input.projectId, uid: { in: input.agentUids } },
      data: {
        consentConfirmedBy: input.confirmedBy,
        consentConfirmedAt: confirmedAt,
        consentBasis: input.basis,
        consentBatchId: batchId,
        version: { increment: 1 },
      },
    });
    return result.count;
  }

  async mergeAgents(input: MergeAgentsInput, actorId: string, correlationId: string) {
    const [source, target] = await Promise.all([
      this.findAgent(input.organizationId, input.projectId, input.sourceAgentUid),
      this.findAgent(input.organizationId, input.projectId, input.targetAgentUid),
    ]);
    if (!source || !target || source.version !== input.sourceVersion || target.version !== input.targetVersion) return null;
    try {
      const sourceUpdate = await this.transaction.agent.updateMany({
        where: { organizationId: input.organizationId, projectId: input.projectId, uid: source.uid, version: source.version },
        data: { status: "HIDDEN", showOnSite: false, version: { increment: 1 } },
      });
      const targetUpdate = await this.transaction.agent.updateMany({
        where: { organizationId: input.organizationId, projectId: input.projectId, uid: target.uid, version: target.version },
        data: { version: { increment: 1 } },
      });
      if (sourceUpdate.count !== 1 || targetUpdate.count !== 1) {
        throw new ProjectStateError("AGENT_NOT_FOUND_OR_STALE");
      }
      await this.transaction.agentExternalIdentity.updateMany({
        where: { organizationId: input.organizationId, projectId: input.projectId, agentUid: source.uid },
        data: { agentUid: target.uid, version: { increment: 1 } },
      });
      await this.transaction.agentMergeEvent.create({
        data: {
          organizationId: input.organizationId, projectId: input.projectId, type: "MERGE",
          sourceAgentUid: source.uid, targetAgentUid: target.uid, actorId, correlationId,
          detail: { sourceHidden: true },
        },
      });
      return {
        source: (await this.findAgent(input.organizationId, input.projectId, source.uid))!,
        target: (await this.findAgent(input.organizationId, input.projectId, target.uid))!,
      };
    } catch (error) {
      translateAgentWriteError(error);
    }
  }

  async relinkIdentity(input: RelinkAgentIdentityInput, actorId: string, correlationId: string): Promise<boolean> {
    const target = await this.findAgent(input.organizationId, input.projectId, input.targetAgentUid);
    if (!target || target.version !== input.targetVersion) return false;
    const identity = await this.transaction.agentExternalIdentity.findFirst({
      where: { id: input.externalIdentityId, organizationId: input.organizationId, projectId: input.projectId, agentUid: input.sourceAgentUid },
    });
    if (!identity) return false;
    await this.transaction.agentExternalIdentity.update({ where: { id: identity.id }, data: { agentUid: target.uid, version: { increment: 1 } } });
    const targetUpdate = await this.transaction.agent.updateMany({
      where: { organizationId: input.organizationId, projectId: input.projectId, uid: target.uid, version: input.targetVersion },
      data: { version: { increment: 1 } },
    });
    if (targetUpdate.count !== 1) throw new ProjectStateError("AGENT_NOT_FOUND_OR_STALE");
    await this.transaction.agentMergeEvent.create({
      data: {
        organizationId: input.organizationId, projectId: input.projectId, type: "RELINK",
        sourceAgentUid: input.sourceAgentUid, targetAgentUid: target.uid, externalIdentityId: identity.id,
        actorId, correlationId, detail: { identityMoved: true },
      },
    });
    return true;
  }

  async splitIdentity(input: SplitAgentIdentityInput, newAgentUid: string, actorId: string, correlationId: string): Promise<AgentAdminItem | null> {
    const source = await this.findAgent(input.organizationId, input.projectId, input.sourceAgentUid);
    if (!source || source.version !== input.sourceVersion) return null;
    const identity = await this.transaction.agentExternalIdentity.findFirst({
      where: { id: input.externalIdentityId, organizationId: input.organizationId, projectId: input.projectId, agentUid: source.uid },
    });
    if (!identity) return null;
    try {
      const created = await this.transaction.agent.create({
        data: {
          uid: newAgentUid, organizationId: input.organizationId, projectId: input.projectId,
          slug: input.newAgentSlug, fullName: input.newAgentFullName, origin: "FEED",
        },
      });
      await this.transaction.agentExternalIdentity.update({ where: { id: identity.id }, data: { agentUid: created.uid, version: { increment: 1 } } });
      const sourceUpdate = await this.transaction.agent.updateMany({
        where: { organizationId: input.organizationId, projectId: input.projectId, uid: source.uid, version: input.sourceVersion },
        data: { version: { increment: 1 } },
      });
      if (sourceUpdate.count !== 1) throw new ProjectStateError("AGENT_NOT_FOUND_OR_STALE");
      await this.transaction.agentMergeEvent.create({
        data: {
          organizationId: input.organizationId, projectId: input.projectId, type: "SPLIT",
          sourceAgentUid: source.uid, targetAgentUid: created.uid, externalIdentityId: identity.id,
          actorId, correlationId, detail: { identityMoved: true },
        },
      });
      return toAgent(created);
    } catch (error) {
      translateAgentWriteError(error);
    }
  }

  async appendAudit(input: AgentAuditInput): Promise<void> {
    await this.transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorType: "USER",
        actorId: input.actorId,
        action: input.action,
        entityType: "Agent",
        entityId: input.entityId,
        beforeMarker: input.beforeMarker ? input.beforeMarker as Prisma.InputJsonObject : Prisma.JsonNull,
        afterMarker: input.afterMarker as Prisma.InputJsonObject,
        source: "project-state",
        correlationId: input.correlationId,
      },
    });
  }
}
