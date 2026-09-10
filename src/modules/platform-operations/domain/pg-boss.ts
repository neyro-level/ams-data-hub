import { z } from "zod";

export const OUTBOX_DELIVERY_QUEUE = "outbox.dispatch";
export const OUTBOX_DELIVERY_SCHEMA = 1;
export const OUTBOX_HANDLER_MAX_ATTEMPTS = 5;
export const OUTBOX_RETRY_DELAY_SECONDS = 30;
export const OUTBOX_RETRY_DELAY_MAX_SECONDS = 3600;
export const OUTBOX_EXPIRE_IN_SECONDS = 900;
export const OUTBOX_PGBOSS_CONNECTION_MAX = 3;
export const OUTBOX_MAX_PAYLOAD_BYTES = 65_536;

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

export const outboxDispatchEventSchema = z.object({
  outboxEventId: z.string().trim().min(1),
  jobRunId: z.string().trim().min(1),
  workerId: z.string().trim().min(1),
  organizationId: z.string().trim().min(1).nullable(),
  topic: z.string().trim().min(1),
  payload: z.record(z.string(), jsonValueSchema),
  attempt: z.number().int().positive(),
  correlationId: z.string().uuid(),
  schemaVersion: z.number().int().positive(),
  occurredAt: z.string().datetime(),
});

export const outboxDispatchJobSchema = z.object({
  schemaVersion: z.literal(OUTBOX_DELIVERY_SCHEMA),
  event: outboxDispatchEventSchema,
});

export type OutboxDispatchEvent = z.infer<typeof outboxDispatchEventSchema>;
export type OutboxDispatchJob = z.infer<typeof outboxDispatchJobSchema>;
