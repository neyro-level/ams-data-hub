import type { CanonicalJsonValue, ProjectExitBundleV1 } from "@ams-data-hub/data-contracts";

export interface ExitBundleDatasetInput {
  kind: ProjectExitBundleV1["datasets"][number]["kind"];
  records: readonly CanonicalJsonValue[];
}

export interface ExitBundleMediaInput {
  sourceStorageKey: string;
  targetPath: string;
  targetUrl: string;
  sha256: string;
  bytes: number;
  contentType: string;
}

export interface ExitBundleContractInput {
  path: `contracts/${string}`;
  body: Uint8Array;
}

export interface ExitBundleFile {
  path: string;
  body: Uint8Array;
  sha256: string;
  bytes: number;
}

export interface ProjectExitBundleComposition {
  manifest: ProjectExitBundleV1;
  files: readonly ExitBundleFile[];
}

export interface ExitBundleMediaTransferPort {
  copy(input: {
    sourceStorageKey: string;
    targetPath: string;
    expectedSha256: string;
    expectedBytes: number;
    contentType: string;
  }): Promise<void>;
}

export interface ExitBundleAuditPort {
  record(input: { projectId: string; actorId: string; correlationId: string; manifestSha256: string; generatedAt: string }): Promise<void>;
}

export interface ProtectedConsentEvidenceInput {
  projectId: string;
  generatedAt: string;
  legalBasisReference: string;
  entries: readonly {
    agentUid: string;
    confirmedBy: string;
    confirmedAt: string;
    basis: string;
    referenceUrl: string | null;
    note: string | null;
  }[];
}

export interface ProtectedConsentTransferPort {
  write(input: { projectId: string; body: Uint8Array; sha256: string }): Promise<{ receiptId: string }>;
}

export interface ProtectedConsentAuditPort {
  record(input: { projectId: string; actorId: string; correlationId: string; sha256: string; entryCount: number; receiptId: string }): Promise<void>;
}
