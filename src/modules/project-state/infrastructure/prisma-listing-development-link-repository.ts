import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { CreateListingDevelopmentCandidateInput, DecideListingDevelopmentLinkInput } from "../contracts.ts";
import { ProjectStateError } from "../domain/project-state-error.ts";
import type {
  ListingDevelopmentLinkAuditInput,
  ListingDevelopmentLinkRepository,
  StoredListingDevelopmentLink,
} from "../application/ports/listing-development-link-repository.ts";

function markerJson(marker: Record<string, string | number | boolean>): Prisma.InputJsonObject {
  return { ...marker };
}

export class PrismaListingDevelopmentLinkRepository implements ListingDevelopmentLinkRepository {
  constructor(private readonly transaction: DatabaseTransaction) {}

  async projectExists(organizationId: string, projectId: string): Promise<boolean> {
    return await this.transaction.project.count({ where: { organizationId, id: projectId } }) === 1;
  }

  async developmentExists(developmentUid: string): Promise<boolean> {
    return await this.transaction.development.count({ where: { uid: developmentUid } }) === 1;
  }

  async createCandidate(input: CreateListingDevelopmentCandidateInput): Promise<StoredListingDevelopmentLink> {
    try {
      return await this.transaction.listingDevelopmentLink.create({
        data: {
          organizationId: input.organizationId,
          projectId: input.projectId,
          inventoryUid: input.inventoryUid,
          developmentUid: input.developmentUid,
          candidateReason: input.candidateReason,
          candidateConfidence: input.candidateConfidence,
          sourceRevisionId: input.sourceRevisionId,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") throw new ProjectStateError("LISTING_DEVELOPMENT_CANDIDATE_EXISTS");
        if (error.code === "P2003") throw new ProjectStateError("LISTING_DEVELOPMENT_REFERENCE_INVALID");
      }
      throw error;
    }
  }

  findById(organizationId: string, projectId: string, linkId: string): Promise<StoredListingDevelopmentLink | null> {
    return this.transaction.listingDevelopmentLink.findFirst({ where: { id: linkId, organizationId, projectId } });
  }

  async decide(input: DecideListingDevelopmentLinkInput, actorId: string, decidedAt: Date): Promise<StoredListingDevelopmentLink | null> {
    const updated = await this.transaction.listingDevelopmentLink.updateMany({
      where: {
        id: input.linkId,
        organizationId: input.organizationId,
        projectId: input.projectId,
        status: "CANDIDATE",
        version: input.version,
        ...(input.decision === "CONFIRMED" ? { developmentUid: { not: null } } : {}),
      },
      data: {
        status: input.decision,
        confirmedBy: actorId,
        confirmedAt: decidedAt,
        version: { increment: 1 },
      },
    });
    return updated.count === 1 ? this.findById(input.organizationId, input.projectId, input.linkId) : null;
  }

  async appendAudit(input: ListingDevelopmentLinkAuditInput): Promise<void> {
    await this.transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorType: input.actorType,
        actorId: input.actorId,
        action: input.action,
        entityType: "ListingDevelopmentLink",
        entityId: input.linkId,
        beforeMarker: input.beforeMarker ? markerJson(input.beforeMarker) : Prisma.JsonNull,
        afterMarker: markerJson(input.afterMarker),
        source: "project-state",
        correlationId: input.correlationId,
      },
    });
  }
}
