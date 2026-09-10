export interface EnqueueReliabilityEventInput {
  organizationId: string | null;
  organizationScope: string;
  idempotencyScope: string;
  idempotencyKey: string;
  requestHash: string;
  topic: string;
  payload: Record<string, unknown>;
  actorType: "USER" | "SYSTEM";
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  source: string;
  correlationId: string;
  schemaVersion: number;
  occurredAt: string;
  availableAt: string;
  expiresAt: string;
}

export interface EnqueueReliabilityEventResult {
  outboxEventId: string;
  duplicate: boolean;
}

export interface ClaimReliabilityEventInput {
  workerId: string;
  now: string;
  leaseTimeoutMs: number;
}

export interface ClaimedReliabilityEvent {
  outboxEventId: string;
  jobRunId: string;
  workerId: string;
  organizationId: string | null;
  topic: string;
  payload: Record<string, unknown>;
  attempt: number;
  correlationId: string;
  schemaVersion: number;
  occurredAt: string;
}

export interface CompleteReliabilityEventInput {
  outboxEventId: string;
  jobRunId: string;
  workerId: string;
  finishedAt: string;
}

export interface FailReliabilityEventInput extends CompleteReliabilityEventInput {
  safeErrorCode: string;
  retryable: boolean;
  maxAttempts: number;
}

export interface FailReliabilityEventResult {
  status: "pending" | "dead_letter";
  availableAt: string | null;
}

export interface TakeOverReliabilityEventInput {
  outboxEventId: string;
  jobRunId: string;
  workerId: string;
  now: string;
}

export interface OutboxHealth {
  pending: number;
  processing: number;
  deadLetter: number;
}

export interface ReliabilityRepository {
  enqueueEvent(input: EnqueueReliabilityEventInput): Promise<EnqueueReliabilityEventResult>;
  claimNextEvent(input: ClaimReliabilityEventInput): Promise<ClaimedReliabilityEvent | null>;
  takeOverEvent(input: TakeOverReliabilityEventInput): Promise<ClaimedReliabilityEvent | null>;
  completeEvent(input: CompleteReliabilityEventInput): Promise<void>;
  failEvent(input: FailReliabilityEventInput): Promise<FailReliabilityEventResult>;
  getOutboxHealth(): Promise<OutboxHealth>;
}
