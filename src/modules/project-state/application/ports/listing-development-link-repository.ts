import type { CreateListingDevelopmentCandidateInput, DecideListingDevelopmentLinkInput } from "../../contracts.ts";

export interface StoredListingDevelopmentLink {
  id: string;
  organizationId: string;
  projectId: string;
  inventoryUid: string;
  developmentUid: string | null;
  status: "CANDIDATE" | "CONFIRMED" | "REJECTED";
  version: number;
}

export interface ListingDevelopmentLinkAuditInput {
  organizationId: string;
  actorType: "USER" | "SYSTEM";
  actorId: string;
  correlationId: string;
  linkId: string;
  action: "listing-development.candidate.create" | "listing-development.decision";
  beforeMarker: Record<string, string | number | boolean> | null;
  afterMarker: Record<string, string | number | boolean>;
}

export interface ListingDevelopmentLinkRepository {
  projectExists(organizationId: string, projectId: string): Promise<boolean>;
  developmentExists(developmentUid: string): Promise<boolean>;
  createCandidate(input: CreateListingDevelopmentCandidateInput): Promise<StoredListingDevelopmentLink>;
  findById(organizationId: string, projectId: string, linkId: string): Promise<StoredListingDevelopmentLink | null>;
  decide(input: DecideListingDevelopmentLinkInput, actorId: string, decidedAt: Date): Promise<StoredListingDevelopmentLink | null>;
  appendAudit(input: ListingDevelopmentLinkAuditInput): Promise<void>;
}
