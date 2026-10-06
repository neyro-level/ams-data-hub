import { z } from "zod";

const count = z.number().int().min(0).max(100_000);
const hours = z.number().finite().min(0).max(87_600);
export const sourceSafetyPolicySchema = z.object({
  maxRawArtifactBytes: z.number().int().positive().max(256 * 1024 * 1024).optional(),
  allowEmpty: z.boolean(), maxDropPercent: z.number().finite().min(0).max(100),
  requireManualApprovalAboveDrop: z.boolean(), deactivationEnabled: z.boolean(),
  inactiveAfterMissingGoodRuns: z.number().int().min(1).max(100_000),
  inactiveAfterMissingHours: hours, sourceOverdueAfterHours: hours, ackStaleAfterHours: hours,
  minRecordCount: count.nullable(), maxRecordCount: count.nullable(),
  maxGrowthPercent: z.number().finite().nonnegative().max(1_000_000).nullable(),
  maxInvalidPercent: z.number().finite().min(0).max(100).nullable(),
}).strip().refine((policy) => policy.minRecordCount === null || policy.maxRecordCount === null || policy.minRecordCount <= policy.maxRecordCount);
