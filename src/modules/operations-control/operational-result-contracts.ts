import { z } from "zod";

export const rejectedRevisionResultSchema = z.object({
  action: z.literal("SUSPICIOUS_REJECT"), sourceRevisionId: z.string().min(1).max(128),
}).strict();
export const stagedSnapshotResultSchema = z.object({ action: z.literal("SNAPSHOT_BUILD"),
  buildInputId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u), inputHash: z.string().regex(/^[a-f0-9]{64}$/u),
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/u), publishSequence: z.number().int().positive().max(2_147_483_647),
}).strict();
export const publishedSnapshotResultSchema = z.object({ action: z.literal("SNAPSHOT_PUBLISH"),
  buildInputId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u), deliveryRunId: z.string().min(1).max(128),
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/u), publishSequence: z.number().int().positive().max(2_147_483_647),
}).strict();
export const rolledBackSnapshotResultSchema = z.object({ action: z.literal("SNAPSHOT_ROLLBACK"),
  sourcePublishSequence: z.number().int().positive().max(2_147_483_647), sourceDeliveryRunId: z.string().min(1).max(128),
  deliveryRunId: z.string().min(1).max(128), manifestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  publishSequence: z.number().int().positive().max(2_147_483_647),
}).strict();
export const rotatedAckResultSchema = z.object({ action: z.literal("ACK_ROTATE"), phase: z.enum(["STAGE", "PROMOTE"]),
  previousCredentialVersion: z.number().int().positive().max(2_147_483_646), credentialVersion: z.number().int().positive().max(2_147_483_647) }).strict();
export const approvedRevisionResultSchema = z.object({ action: z.literal("SUSPICIOUS_APPROVE"),
  sourceRevisionId: z.string().min(1).max(128),sequence: z.number().int().positive().max(2_147_483_647),snapshotTriggered: z.literal(true) }).strict();
export const operationalResultSchema = z.discriminatedUnion("action", [rejectedRevisionResultSchema, stagedSnapshotResultSchema, publishedSnapshotResultSchema, rolledBackSnapshotResultSchema, rotatedAckResultSchema, approvedRevisionResultSchema]);
