import { describe, expect, it } from "vitest";
import {
  SNAPSHOT_INPUT_PART_KINDS, SNAPSHOT_INPUT_MAX_PARTS, SnapshotInputPartsBuilder,
  snapshotInputHash, snapshotInputRequestSchema, snapshotInputRequestHashes, snapshotBuildInputDigest,
} from "../src/modules/snapshot-delivery/index.ts";

describe("bounded immutable snapshot input parts", () => {
  it("requires every fact section; preserves part order and owns reader values", () => {
    const builder = new SnapshotInputPartsBuilder();
    const value = { name: "Synthetic catalog" };
    builder.add("catalog", [value]);
    value.name = "Changed after capture";
    expect(() => builder.finish()).toThrow("SNAPSHOT_INPUT_INCOMPLETE");
    for (const kind of SNAPSHOT_INPUT_PART_KINDS) if (kind !== "catalog") builder.add(kind, []);
    builder.add("catalog", [{ name: "Second page" }]);
    const parts = builder.finish();
    expect(parts.filter((part) => part.kind === "catalog")).toMatchObject([
      { partIndex: 0, payload: [{ name: "Synthetic catalog" }] },
      { partIndex: 1, payload: [{ name: "Second page" }] },
    ]);
    parts[0]!.payload.push("Mutation of returned array");
    expect(builder.finish()[0]!.payload).toEqual([]);
    for (const part of builder.finish()) expect(part.payloadHash).toBe(snapshotInputHash(part.payload));
  });

  it("rejects page, single payload, total record and empty-part overflow", () => {
    expect(() => new SnapshotInputPartsBuilder().add("inventory", Array(201).fill(null))).toThrow("SNAPSHOT_INPUT_LIMIT_EXCEEDED");
    expect(() => new SnapshotInputPartsBuilder().add("inventory", ["x".repeat(1024 * 1024)])).toThrow("SNAPSHOT_INPUT_LIMIT_EXCEEDED");
    const records = new SnapshotInputPartsBuilder();
    for (let n = 0; n < 250; n++) records.add("inventory", Array(200).fill(null));
    expect(() => records.add("inventory", [null])).toThrow("SNAPSHOT_INPUT_LIMIT_EXCEEDED");
    expect(() => records.finish()).toThrow("SNAPSHOT_INPUT_CAPTURE_FAILED");
    const empty = new SnapshotInputPartsBuilder();
    for (let n = 0; n < SNAPSHOT_INPUT_MAX_PARTS; n++) empty.add("inventory", []);
    expect(() => empty.add("inventory", [])).toThrow("SNAPSHOT_INPUT_LIMIT_EXCEEDED");
    expect(() => empty.add("catalog", [])).toThrow("SNAPSHOT_INPUT_CAPTURE_FAILED");
    const bytes = new SnapshotInputPartsBuilder();
    for (let n = 0; n < 33; n++) bytes.add("inventory", ["x".repeat(1_000_000)]);
    expect(() => bytes.add("inventory", ["x".repeat(1_000_000)])).toThrow("SNAPSHOT_INPUT_LIMIT_EXCEEDED");
  });

  it("hashes request parameters without mutable current DB facts; key is separately hashed", () => {
    const request = snapshotInputRequestSchema.parse({ organizationId: "org-a", projectId: "project-a", idempotencyKey: "request-a" });
    const hashes = snapshotInputRequestHashes(request);
    expect(hashes.idempotencyKeyHash).toHaveLength(64);
    expect(hashes.requestHash).toBe(snapshotInputRequestHashes({ ...request, idempotencyKey: "request-b" }).requestHash);
    expect(hashes.requestHash).not.toBe(snapshotInputRequestHashes({ ...request, schemaMinor: 1 }).requestHash);
    expect(hashes.requestHash).not.toBe(snapshotInputRequestHashes({ ...request, projectId: "project-b" }).requestHash);
    expect(() => snapshotInputRequestSchema.parse({ ...request, sourceEndpoint: "private" })).toThrow();
  });

  it("pins sequence, schema, timestamp and section digests in the complete input hash", () => {
    const builder = new SnapshotInputPartsBuilder();
    for (const kind of SNAPSHOT_INPUT_PART_KINDS) builder.add(kind, []);
    const input = {
      organizationId: "org-a", projectId: "project-a", idempotencyKeyHash: "a".repeat(64), requestHash: "b".repeat(64),
      inputSchemaVersion: 1, projectorVersion: "db-v1", schemaMinor: 0, publishSequence: 1,
      projectStateRevision: 1, catalogRevision: "c".repeat(64), capturedAt: new Date("2026-10-06T00:00:00.000Z"),
      parts: builder.finish(),
    };
    const digest = snapshotBuildInputDigest(input);
    expect(digest).toHaveLength(64);
    expect(digest).toBe(snapshotBuildInputDigest(structuredClone(input)));
    expect(digest).not.toBe(snapshotBuildInputDigest({ ...input, publishSequence: 2 }));
    expect(digest).not.toBe(snapshotBuildInputDigest({ ...input, capturedAt: new Date("2026-10-06T00:00:01.000Z") }));
  });
});
