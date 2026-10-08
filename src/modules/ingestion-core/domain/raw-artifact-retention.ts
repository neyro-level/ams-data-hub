import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
export const rawArtifactRetentionPolicySchema = z.object({
  lastGoodRevisions: z.number().int().min(1).max(1000),
  recentDays: z.number().int().min(1).max(3650),
  documentedPurpose: z.string().trim().min(1).max(255).nullable(),
}).strict().superRefine((policy, context) => {
  // A deployment override, including a shorter window, requires an explicit
  // purpose. The default is the union, never the intersection, of both rules.
  if ((policy.lastGoodRevisions !== 3 || policy.recentDays !== 30) && !policy.documentedPurpose)
    context.addIssue({ code: "custom", message: "RAW_RETENTION_OVERRIDE_PURPOSE_REQUIRED" });
});
export type RawArtifactRetentionPolicy = z.infer<typeof rawArtifactRetentionPolicySchema>;
export const DEFAULT_RAW_ARTIFACT_RETENTION_POLICY: Readonly<RawArtifactRetentionPolicy> = Object.freeze({
  lastGoodRevisions: 3, recentDays: 30, documentedPurpose: null,
});

const referenceSchema = z.object({
  organizationId: id, projectId: id, sourceId: id, revisionId: id,
  rawArtifactHash: sha256, storageKey: z.string(),
  status: z.enum(["PENDING", "STAGED", "SUSPICIOUS", "REJECTED", "FAILED", "GOOD"]),
  sequence: z.number().int().positive().nullable(),
  // Server-recorded times, not caller policy hints. A late completion extends
  // the recent-reference window; future clocks fail closed by retaining.
  startedAt: z.date(), completedAt: z.date().nullable(),
}).strict().superRefine((reference, context) => {
  if (reference.storageKey !== `source-artifacts/${reference.rawArtifactHash}`)
    context.addIssue({ code: "custom", message: "RAW_RETENTION_KEY_HASH_MISMATCH" });
  if (reference.status === "GOOD" && (reference.sequence === null || reference.completedAt === null))
    context.addIssue({ code: "custom", message: "RAW_RETENTION_GOOD_IDENTITY_INVALID" });
  if (reference.completedAt && reference.completedAt < reference.startedAt)
    context.addIssue({ code: "custom", message: "RAW_RETENTION_REFERENCE_TIME_INVALID" });
});
export type RawArtifactRetentionReference = z.infer<typeof referenceSchema>;
export type RawArtifactRetentionReason = "INCOMPLETE_COVERAGE" | "JOBS_FROZEN" | "RECENT_REFERENCE"
  | "LAST_GOOD_WINDOW" | "PINNED_REVISION" | "UNSETTLED_REFERENCE";
export interface RawArtifactRetentionDecision {
  readonly rawArtifactHash: string;
  /** Internal storage capability input only; never a public/audit DTO. */
  readonly storageKey: string;
  readonly eligible: boolean;
  readonly reasons: readonly RawArtifactRetentionReason[];
  readonly referenceCount: number;
}

/** Pure planning only. Destructive execution additionally requires a fresh
 * complete repository cut, project/hash lifetime exclusion, freeze admission
 * and a durable audited deletion record. A plan itself authorizes no DELETE. */
export function planRawArtifactRetention(input: {
  organizationId: string; projectId: string; now: Date;
  policy?: RawArtifactRetentionPolicy;
  references: readonly RawArtifactRetentionReference[];
  /** LastGood, active facts and current/pending/rollback capture pins, resolved
   * by the repository across ALL Sources sharing the project storage scope. */
  pinnedRevisionIds: readonly string[];
  coverage: "COMPLETE" | "INCOMPLETE";
  jobsFrozen: boolean;
}): readonly RawArtifactRetentionDecision[] {
  const organizationId = id.parse(input.organizationId);
  const projectId = id.parse(input.projectId);
  const now = z.date().parse(input.now).getTime();
  const policy = rawArtifactRetentionPolicySchema.parse(input.policy ?? DEFAULT_RAW_ARTIFACT_RETENTION_POLICY);
  const pins = new Set(input.pinnedRevisionIds.map((value) => id.parse(value)));
  const references = input.references.map((value) => referenceSchema.parse(value));
  const revisions = new Set<string>();
  const goodBySource = new Map<string, RawArtifactRetentionReference[]>();
  for (const reference of references) {
    if (reference.organizationId !== organizationId || reference.projectId !== projectId)
      throw new Error("RAW_RETENTION_FOREIGN_REFERENCE");
    if (revisions.has(reference.revisionId)) throw new Error("RAW_RETENTION_DUPLICATE_REVISION");
    revisions.add(reference.revisionId);
    if (reference.status === "GOOD") {
      const good = goodBySource.get(reference.sourceId) ?? [];
      good.push(reference); goodBySource.set(reference.sourceId, good);
    }
  }
  const lastGood = new Set<string>();
  for (const good of goodBySource.values()) {
    good.sort((a, b) => b.sequence! - a.sequence!);
    for (let index = 1; index < good.length; index++)
      if (good[index]!.sequence === good[index - 1]!.sequence) throw new Error("RAW_RETENTION_DUPLICATE_GOOD_SEQUENCE");
    for (const reference of good.slice(0, policy.lastGoodRevisions)) lastGood.add(reference.revisionId);
  }
  const groups = new Map<string, RawArtifactRetentionReference[]>();
  for (const reference of references) {
    const group = groups.get(reference.rawArtifactHash) ?? [];
    group.push(reference); groups.set(reference.rawArtifactHash, group);
  }
  const cutoff = now - policy.recentDays * 86_400_000;
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([hash, group]) => {
    const reasons = new Set<RawArtifactRetentionReason>();
    if (input.coverage !== "COMPLETE") reasons.add("INCOMPLETE_COVERAGE");
    if (input.jobsFrozen !== false) reasons.add("JOBS_FROZEN");
    for (const reference of group) {
      if (Math.max(reference.startedAt.getTime(), reference.completedAt?.getTime() ?? 0) >= cutoff)
        reasons.add("RECENT_REFERENCE");
      if (lastGood.has(reference.revisionId)) reasons.add("LAST_GOOD_WINDOW");
      if (pins.has(reference.revisionId)) reasons.add("PINNED_REVISION");
      // Approval/capture work may still use staged or suspicious raw evidence.
      if (["PENDING", "STAGED", "SUSPICIOUS"].includes(reference.status)) reasons.add("UNSETTLED_REFERENCE");
    }
    return { rawArtifactHash: hash, storageKey: `source-artifacts/${hash}`, eligible: reasons.size === 0,
      reasons: [...reasons], referenceCount: group.length };
  });
}
