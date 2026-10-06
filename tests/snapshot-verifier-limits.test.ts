import {
  createSnapshotVerifier, DEFAULT_SNAPSHOT_VERIFIER_LIMITS, MAX_SNAPSHOT_VERIFIER_LIMITS,
  resolveSnapshotVerifierLimits, SNAPSHOT_DATASET_KINDS, type SnapshotVerifierLimits,
} from "@ams-data-hub/snapshot-verifier";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const limitKeys = Object.keys(DEFAULT_SNAPSHOT_VERIFIER_LIMITS) as Array<keyof SnapshotVerifierLimits>;
const datasetSchemas = Object.fromEntries(SNAPSHOT_DATASET_KINDS.map((kind) => [kind, z.array(z.unknown())])) as unknown as Record<(typeof SNAPSHOT_DATASET_KINDS)[number], z.ZodType<readonly unknown[]>>;

describe("snapshot verifier limit policy", () => {
  it("has finite immutable defaults and hard ceilings, with independent instances", () => {
    const first = resolveSnapshotVerifierLimits();
    const second = resolveSnapshotVerifierLimits();
    expect(first).toEqual(DEFAULT_SNAPSHOT_VERIFIER_LIMITS);
    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SNAPSHOT_VERIFIER_LIMITS)).toBe(true);
    expect(Object.isFrozen(MAX_SNAPSHOT_VERIFIER_LIMITS)).toBe(true);
    for (const key of limitKeys) {
      expect(Number.isSafeInteger(first[key])).toBe(true);
      expect(first[key]).toBeGreaterThan(0);
      expect(first[key]).toBeLessThanOrEqual(MAX_SNAPSHOT_VERIFIER_LIMITS[key]);
    }
  });

  it.each(limitKeys)("allows explicit bounded overrides of %s without mutating the caller", (key) => {
    const policy = { [key]: MAX_SNAPSHOT_VERIFIER_LIMITS[key] };
    expect(resolveSnapshotVerifierLimits(policy)[key]).toBe(MAX_SNAPSHOT_VERIFIER_LIMITS[key]);
    expect(resolveSnapshotVerifierLimits({ [key]: 1 })[key]).toBe(1);
    expect(policy[key]).toBe(MAX_SNAPSHOT_VERIFIER_LIMITS[key]);
  });

  it.each(limitKeys)("rejects unsafe %s configuration at factory construction", (key) => {
    for (const value of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, MAX_SNAPSHOT_VERIFIER_LIMITS[key] + 1, "1", null]) {
      const invalid = { [key]: value } as Partial<SnapshotVerifierLimits>;
      expect(() => resolveSnapshotVerifierLimits(invalid)).toThrow("SNAPSHOT_VERIFIER_LIMIT_INVALID");
      expect(() => createSnapshotVerifier({ datasetSchemas, validateReferences: () => true, ...invalid })).toThrow("SNAPSHOT_VERIFIER_LIMIT_INVALID");
    }
  });
});
