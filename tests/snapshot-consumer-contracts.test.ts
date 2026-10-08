import { describe, expect, it } from "vitest";
import { readSnapshotConsumerBearer, snapshotConsumerArtifactPath, snapshotConsumerKindSchema,
  snapshotConsumerScopeSchema, snapshotConsumerSequenceSchema } from "../src/modules/snapshot-delivery/consumer-contracts.ts";

describe("snapshot consumer bounded HTTP contracts", () => {
  it("accepts only a bounded explicit Bearer header before token work", () => {
    const token = "synthetic-consumer-".repeat(3);
    expect(readSnapshotConsumerBearer(`Bearer ${token}`)).toBe(token);
    for (const value of [null, "", token, `bearer ${token}`, `Bearer ${"x".repeat(31)}`, `Bearer ${"x".repeat(513)}`,
      `Bearer ${token}\n`, `Bearer ${token} `, `Bearer ${token},${token}`]) {
      expect(() => readSnapshotConsumerBearer(value)).toThrow("SNAPSHOT_CONSUMER_UNAUTHORIZED");
    }
  });
  it("rejects wildcard, CSV, traversal, extra scope fields, noncanonical/overflow sequences and arbitrary kinds", () => {
    for (const projectId of ["*", "a,b", "../x", "a/b", "", "x".repeat(129)])
      expect(snapshotConsumerScopeSchema.safeParse({ organizationId: "org", projectId }).success).toBe(false);
    expect(snapshotConsumerScopeSchema.safeParse({ organizationId: "org", projectId: "project", key: "private" }).success).toBe(false);
    for (const sequence of ["0", "01", "-1", "1.0", "1e2", "2147483648", "1/../../x"])
      expect(snapshotConsumerSequenceSchema.safeParse(sequence).success).toBe(false);
    for (const kind of ["source-artifacts", "backups", "../geo", "geo.hash.json.gz", "capture", "*"])
      expect(snapshotConsumerKindSchema.safeParse(kind).success).toBe(false);
    expect(snapshotConsumerSequenceSchema.parse("2147483647")).toBe(2_147_483_647);
  });
  it("uses only scoped sequence/kind URLs, never caller storage keys or hashes", () => {
    expect(snapshotConsumerArtifactPath({ organizationId: "org", projectId: "project" }, 2, "project/contacts"))
      .toBe("/api/snapshots/org/project/2/files/project%2Fcontacts");
  });
});
