import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  ClaimedReliabilityEvent,
  EnqueueReliabilityEventResult,
  FailReliabilityEventResult,
  OutboxHealth,
  ReliabilityRepository,
} from "./ports/reliability-repository.ts";
import {
  OUTBOX_DELIVERY_SCHEMA,
  OUTBOX_MAX_PAYLOAD_BYTES,
} from "../domain/pg-boss.ts";

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const identifierSchema = z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9:._-]{1,127}$/);
const correlationIdSchema = z.string().uuid();
const schemaVersionSchema = z.number().int().positive();

const enqueueEventSchema = z.object({
  organizationId: z.string().min(1).nullable(),
  organizationScope: identifierSchema,
  idempotencyScope: identifierSchema,
  idempotencyKey: identifierSchema,
  topic: identifierSchema,
  payload: z.record(z.string(), jsonValueSchema),
  actorType: z.enum(["USER", "SYSTEM"]),
  actorId: z.string().min(1).nullable(),
  action: identifierSchema,
  entityType: identifierSchema,
  entityId: z.string().min(1).nullable(),
  source: identifierSchema,
  correlationId: correlationIdSchema,
  schemaVersion: schemaVersionSchema.default(OUTBOX_DELIVERY_SCHEMA),
  occurredAt: z.string().datetime().optional(),
  expiresInSeconds: z.number().int().min(60).max(604_800).default(86_400),
}).superRefine((value, context) => {
  const expectedScope = value.organizationId ?? "platform";
  if (value.organizationScope !== expectedScope) {
    context.addIssue({
      code: "custom",
      path: ["organizationScope"],
      message: "Organization scope does not match the command organization",
    });
  }
  if (value.actorType === "USER" && !value.actorId) {
    context.addIssue({
      code: "custom",
      path: ["actorId"],
      message: "User actor requires actorId",
    });
  }
  const payloadBytes = Buffer.byteLength(JSON.stringify(value.payload), "utf8");
  if (payloadBytes > OUTBOX_MAX_PAYLOAD_BYTES) {
    context.addIssue({
      code: "custom",
      path: ["payload"],
      message: `Outbox payload exceeds ${OUTBOX_MAX_PAYLOAD_BYTES} bytes`,
    });
  }
});

const workerSchema = z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9:._-]{1,127}$/);
const safeErrorCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/);

export type EnqueueEventCommand = z.input<typeof enqueueEventSchema>;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

export class ReliabilityService {
  constructor(
    private readonly repository: ReliabilityRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async enqueue(command: EnqueueEventCommand): Promise<EnqueueReliabilityEventResult> {
    const input = enqueueEventSchema.parse(command);
    const now = this.now();
    const requestHash = createHash("sha256").update(canonicalJson(input.payload)).digest("hex");

    return this.repository.enqueueEvent({
      organizationId: input.organizationId,
      organizationScope: input.organizationScope,
      idempotencyScope: input.idempotencyScope,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      topic: input.topic,
      payload: input.payload,
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      source: input.source,
      correlationId: input.correlationId,
      schemaVersion: input.schemaVersion,
      occurredAt: input.occurredAt ?? now.toISOString(),
      availableAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + input.expiresInSeconds * 1000).toISOString(),
    });
  }

  claim(workerId: string, leaseTimeoutMs = 300_000): Promise<ClaimedReliabilityEvent | null> {
    return this.repository.claimNextEvent({
      workerId: workerSchema.parse(workerId),
      now: this.now().toISOString(),
      leaseTimeoutMs: z.number().int().min(1_000).max(3_600_000).parse(leaseTimeoutMs),
    });
  }

  takeOver(event: ClaimedReliabilityEvent, workerId: string): Promise<ClaimedReliabilityEvent | null> {
    return this.repository.takeOverEvent({
      outboxEventId: event.outboxEventId,
      jobRunId: event.jobRunId,
      workerId: workerSchema.parse(workerId),
      now: this.now().toISOString(),
    });
  }

  complete(event: ClaimedReliabilityEvent): Promise<void> {
    return this.repository.completeEvent({
      outboxEventId: event.outboxEventId,
      jobRunId: event.jobRunId,
      workerId: event.workerId,
      finishedAt: this.now().toISOString(),
    });
  }

  fail(
    event: ClaimedReliabilityEvent,
    safeErrorCode: string,
    retryable: boolean,
    maxAttempts = 5,
  ): Promise<FailReliabilityEventResult> {
    return this.repository.failEvent({
      outboxEventId: event.outboxEventId,
      jobRunId: event.jobRunId,
      workerId: event.workerId,
      finishedAt: this.now().toISOString(),
      safeErrorCode: safeErrorCodeSchema.parse(safeErrorCode),
      retryable,
      maxAttempts: z.number().int().min(1).max(20).parse(maxAttempts),
    });
  }

  getHealth(): Promise<OutboxHealth> {
    return this.repository.getOutboxHealth();
  }
}
