import { z } from "zod";
import type { SnapshotCapturedFactProfile } from "../../ingestion-core/server.ts";
import type { SnapshotBuildInputReceipt } from "./snapshot-build-input.ts";
import { validateSnapshotInput } from "./snapshot-input-validation.ts";

const identity = z.string().regex(/^[A-Za-z0-9_-]{1,128}@[A-Za-z0-9_.-]{1,128}$/u);
const path = z.string().regex(/^[\w@/-]{1,240}$/u)
  .refine((value) => value.split("/").length <= 10 && !value.split("/").some((part) => !part));
const mapping = z.object({ sourcePath: path, targetField: z.string().regex(/^[A-Za-z][A-Za-z0-9.]{0,127}$/u),
  sparse: z.boolean() }).strict();
// Only the resolver-owned selection is retained; private profile configuration
// (including office contacts and regex patterns) is not copied into this map.
const configuration = z.object({ externalOfferIdPath: z.literal("offer@internal-id"),
  fieldMappings: z.array(mapping).max(200) });
const format = z.object({ family: z.enum(["YRL_2010", "AVITO_V3", "CIAN_V2"]),
  caseSensitiveTags: z.boolean() });
const capturedProfile = z.object({ entityType: z.literal("profile"), identity,
  configuration: configuration.nullable(), formatContract: format.nullable() }).strict();

/** Internal captured GOOD lookup selection, never a public dataset or a registry lookup. */
export function prepareSnapshotFactProfiles(input: SnapshotBuildInputReceipt): ReadonlyMap<string, SnapshotCapturedFactProfile> {
  const parts = validateSnapshotInput(input);
  const required = new Set<string>();
  for (const part of parts) if (part.kind === "inventory") for (const raw of part.payload) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.status !== "ACTIVE") continue;
    const parsed = identity.safeParse(raw.factProfileIdentity);
    if (!parsed.success) throw new Error("SNAPSHOT_GOOD_PROFILE_INVALID");
    required.add(parsed.data);
  }
  const profiles = new Map<string, SnapshotCapturedFactProfile>();
  for (const part of parts) if (part.kind === "sources") for (const raw of part.payload) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.entityType !== "profile") continue;
    if (typeof raw.identity !== "string" || !required.has(raw.identity)) continue;
    const parsed = capturedProfile.safeParse(raw);
    if (!parsed.success) throw new Error("SNAPSHOT_GOOD_PROFILE_INVALID");
    const row = parsed.data;
    if (profiles.has(row.identity) || (!row.configuration && !row.formatContract)
      || (row.configuration && row.formatContract && row.formatContract.family !== "YRL_2010")) {
      throw new Error("SNAPSHOT_GOOD_PROFILE_INVALID");
    }
    const fieldMappings = row.configuration?.fieldMappings ?? [];
    if (new Set(fieldMappings.map((entry) => entry.targetField)).size !== fieldMappings.length) {
      throw new Error("SNAPSHOT_GOOD_PROFILE_INVALID");
    }
    profiles.set(row.identity, { identity: row.identity,
      // Configuration-only YRL capture has the versioned case-sensitive parser baseline.
      // Format-owned profiles preserve the captured flag, including CIAN false.
      caseSensitiveTags: row.formatContract?.caseSensitiveTags ?? true,
      fieldMappings: fieldMappings.map(({ sourcePath, targetField }) => ({ sourcePath, targetField })) });
  }
  if (profiles.size !== required.size) throw new Error("SNAPSHOT_GOOD_PROFILE_INVALID");
  return profiles;
}
