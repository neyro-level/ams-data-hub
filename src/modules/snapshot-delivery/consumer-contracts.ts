import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u);
export const snapshotConsumerScopeSchema = z.object({ organizationId: id, projectId: id }).strict();
export type SnapshotConsumerScope = z.infer<typeof snapshotConsumerScopeSchema>;
export const snapshotConsumerAckSchema = z.object({ projectId: id,
  publishSequence: z.number().int().positive().max(2_147_483_647),
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  applied: z.literal(true), idempotencyKey: z.string().min(16).max(240) }).strict();
export const snapshotConsumerSequenceSchema = z.string().regex(/^[1-9][0-9]{0,9}$/u)
  .transform(Number).pipe(z.number().int().positive().max(2_147_483_647));
export const snapshotConsumerKindSchema = z.enum(["geo", "developers", "developments", "buildings", "prices",
  "media", "inventory", "agents", "project/contacts", "editorial", "urls", "redirects", "lifecycle"]);

/** Never accept tokens in a URL, JSON body or a cookie. Bound before scrypt. */
export function readSnapshotConsumerBearer(value: string | null): string {
  if (!value || value.length > 520) throw new Error("SNAPSHOT_CONSUMER_UNAUTHORIZED");
  const match = /^Bearer ([A-Za-z0-9_~+./=-]{32,512})$/u.exec(value);
  if (!match) throw new Error("SNAPSHOT_CONSUMER_UNAUTHORIZED");
  return match[1]!;
}

export function snapshotConsumerArtifactPath(scope: SnapshotConsumerScope, sequence: number, kind: z.infer<typeof snapshotConsumerKindSchema>): string {
  const parsed = snapshotConsumerScopeSchema.parse(scope);
  const checked = snapshotConsumerSequenceSchema.parse(String(sequence));
  return `/api/snapshots/${parsed.organizationId}/${parsed.projectId}/${checked}/files/${encodeURIComponent(snapshotConsumerKindSchema.parse(kind))}`;
}
