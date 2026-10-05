import type { MediaRightsBasis, MediaSourceKind } from "../../contracts.ts";
import type { AgentMediaPublicationState } from "../../domain/media-source.ts";

export interface MediaMirrorScope {
  organizationId: string;
  projectId: string;
  sourceId: string;
  sourceRevisionId: string;
  observedAt: Date;
}

export interface PersistMirroredAssetInput extends MediaMirrorScope {
  canonicalSourceUrl: string;
  sourceUrl: string;
  entityType: string;
  entityUid: string;
  kind: MediaSourceKind;
  position: number;
  isImageOrderChangeAllowed: boolean;
  sha256: string;
  storageKey: string;
  contentType: string;
  byteSize: number;
  originalFileName: string;
  rightsBasis: MediaRightsBasis;
  license: string | null;
  uploadedBy: string;
}

export interface PersistMediaWarningInput extends MediaMirrorScope {
  canonicalSourceUrl: string;
  sourceUrl: string;
  entityType: string;
  entityUid: string;
  kind: MediaSourceKind;
  position: number;
  isImageOrderChangeAllowed: boolean;
  warningCode: string;
}

export interface MediaMirrorRepository {
  scopeExists(scope: Pick<MediaMirrorScope, "organizationId" | "projectId" | "sourceId">): Promise<boolean>;
  persistMirrored(input: PersistMirroredAssetInput): Promise<{ assetId: string; agent: AgentMediaPublicationState | null }>;
  persistWarning(input: PersistMediaWarningInput): Promise<{ assetId: string | null; agent: AgentMediaPublicationState | null }>;
}
