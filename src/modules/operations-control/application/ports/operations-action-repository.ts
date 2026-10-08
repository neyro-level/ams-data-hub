import type { OperationalAction } from "../../contracts.ts";

export interface RecordOperationalActionRequest {
  action: Exclude<OperationalAction, "RUN_SOURCE">;
  organizationId: string;
  projectId: string;
  sourceId: string | null;
  sourceRevisionId: string | null;
  sourcePublishSequence: number | null;
  buildInputId: string | null;
  ackRotationPhase?: "STAGE" | "PROMOTE" | null;
  ackCredentialVersion?: number | null;
  reason: string | null;
  idempotencyKey: string;
  requestHash: string;
  actorId: string;
  correlationId: string;
}

export interface OperationsActionRepository {
  recordRequest(input: RecordOperationalActionRequest): Promise<{ requestId: string; duplicate: boolean }>;
}
