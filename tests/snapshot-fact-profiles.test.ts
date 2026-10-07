import type { CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { describe, expect, it } from "vitest";
import { vladisVt24Profile, joyworkMarketplaceProfiles } from "../src/modules/ingestion-core/index.ts";
import { prepareSnapshotFactProfiles } from "../src/modules/snapshot-delivery/application/snapshot-fact-profiles.ts";
import { SNAPSHOT_INPUT_PART_KINDS, SnapshotInputPartsBuilder, snapshotBuildInputDigest, snapshotInputHash,
  type SnapshotBuildInputReceipt } from "../src/modules/snapshot-delivery/index.ts";

function receipt(rows: unknown[], required = rows.map((row) => (row as { identity: string }).identity)): SnapshotBuildInputReceipt {
  const builder = new SnapshotInputPartsBuilder();
  for (const kind of SNAPSHOT_INPUT_PART_KINDS) builder.add(kind, kind === "sources"
    ? JSON.parse(JSON.stringify(rows)) as CanonicalJsonValue[] : kind === "inventory"
      ? required.map((factProfileIdentity) => ({ status: "ACTIVE", factProfileIdentity })) : []);
  const parts = builder.finish();
  const input = { id: "synthetic", organizationId: "synthetic-org", projectId: "synthetic-project",
    idempotencyKeyHash: "a".repeat(64), requestHash: "b".repeat(64), inputSchemaVersion: 1,
    projectorVersion: "db-v1", schemaMinor: 0, publishSequence: 1, projectStateRevision: 1,
    capturedAt: new Date("2026-10-07T00:00:00.000Z"), parts, inputHash: "",
    catalogRevision: snapshotInputHash(parts.filter((part) => part.kind === "catalog")
      .map(({ partIndex, payloadHash }) => ({ partIndex, payloadHash }))) };
  input.inputHash = snapshotBuildInputDigest(input); return input;
}
const profiles = [vladisVt24Profile, ...joyworkMarketplaceProfiles].map((profile) => ({ entityType: "profile",
  identity: `${profile.key}@${profile.version}`, configuration: profile.configuration ?? null,
  formatContract: profile.formatContract ?? null }));
describe("captured fact profile selection", () => {
  it("adapts configuration-only and four format-only profiles without live registry selection", () => {
    const input = receipt(profiles); const before = structuredClone(input);
    const map = prepareSnapshotFactProfiles(input);
    expect(map.size).toBe(5);
    expect(map.get("vladis-vt24-v1@1.0.0")).toMatchObject({ caseSensitiveTags: true,
      fieldMappings: [{ sourcePath: "deal-status", targetField: "dealKind" }, ...vladisVt24Profile.configuration!.fieldMappings.slice(1)
        .map(({ sourcePath, targetField }) => ({ sourcePath, targetField }))] });
    expect(map.get("joywork-cian-v2@1.0.0")).toEqual({ identity: "joywork-cian-v2@1.0.0", caseSensitiveTags: false, fieldMappings: [] });
    expect(input).toEqual(before);
    expect(JSON.stringify([...map.values()])).not.toMatch(/sharedOfficePhones|patternSources|safetyPolicy|sparse/u);
  });
  it("owns mapped values and follows changed captured configuration, not registry defaults", () => {
    const row = structuredClone(profiles[0]!);
    row.configuration = { ...row.configuration!, fieldMappings: [{ sourcePath: "floor", targetField: "facts.floor", sparse: true }] };
    const input = receipt([row]); const map = prepareSnapshotFactProfiles(input);
    (input.parts.find((part) => part.kind === "sources")!.payload[0] as Record<string, CanonicalJsonValue>).configuration = null;
    expect(map.get(row.identity)!.fieldMappings).toEqual([{ sourcePath: "floor", targetField: "facts.floor" }]);
  });
  it("rejects receipt tampering before adaptation", () => {
    expect(() => prepareSnapshotFactProfiles({ ...receipt(profiles), inputHash: "c".repeat(64) })).toThrow("SNAPSHOT_INPUT_INVALID");
  });
  it("rejects duplicate, empty and cross-family configurations with finite errors", () => {
    expect(() => prepareSnapshotFactProfiles(receipt([profiles[0], profiles[0]]))).toThrow("SNAPSHOT_GOOD_PROFILE_INVALID");
    expect(() => prepareSnapshotFactProfiles(receipt([{ ...profiles[0], configuration: null }]))).toThrow("SNAPSHOT_GOOD_PROFILE_INVALID");
    expect(() => prepareSnapshotFactProfiles(receipt([{ ...profiles[0], formatContract: profiles[3]!.formatContract }]))).toThrow("SNAPSHOT_GOOD_PROFILE_INVALID");
  });
  it("ignores unrelated legacy source profiles but rejects required unsupported or missing profiles", () => {
    const legacy = { entityType: "profile", identity: "default-v1@1.0.0", configuration: null, formatContract: null };
    expect(prepareSnapshotFactProfiles(receipt([...profiles, legacy], profiles.map((row) => row.identity))).size).toBe(5);
    expect(() => prepareSnapshotFactProfiles(receipt([legacy]))).toThrow("SNAPSHOT_GOOD_PROFILE_INVALID");
    expect(() => prepareSnapshotFactProfiles(receipt([], [profiles[0]!.identity]))).toThrow("SNAPSHOT_GOOD_PROFILE_INVALID");
    expect(prepareSnapshotFactProfiles(receipt([legacy], [])).size).toBe(0);
  });
  it("rejects oversized mappings and duplicate targets without echoing private input", () => {
    for (const fieldMappings of [Array.from({ length: 201 }, () => ({ sourcePath: "floor", targetField: "facts.floor", sparse: true })),
      [{ sourcePath: "floor", targetField: "facts.floor", sparse: true }, { sourcePath: "rooms", targetField: "facts.floor", sparse: true }],
      [{ sourcePath: "https://private.example", targetField: "facts.floor", sparse: true }]]) {
      expect(() => prepareSnapshotFactProfiles(receipt([{ ...profiles[0], configuration: { ...profiles[0]!.configuration, fieldMappings } }])))
        .toThrow("SNAPSHOT_GOOD_PROFILE_INVALID");
    }
  });
});
