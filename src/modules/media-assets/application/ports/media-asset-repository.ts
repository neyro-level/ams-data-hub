import type { MediaAssetRecord, ValidatedMediaIntakeInput } from "../../contracts.ts";

export interface PersistMediaAssetInput extends Omit<ValidatedMediaIntakeInput, "body"> {
  sha256: string;
  storageKey: string;
  byteSize: number;
  uploadedBy: string;
}

export interface MediaAssetAuditInput {
  actorId: string;
  organizationId: string;
  assetId: string;
  projectId: string;
  sha256: string;
  correlationId: string;
}

export interface MediaAssetRepository {
  projectExists(organizationId: string, projectId: string): Promise<boolean>;
  findByDigest(projectId: string, sha256: string): Promise<MediaAssetRecord | null>;
  upsert(input: PersistMediaAssetInput): Promise<MediaAssetRecord>;
  appendAudit(input: MediaAssetAuditInput): Promise<void>;
}
