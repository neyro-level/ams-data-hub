import { describe, expect, it } from "vitest";
import { sourceSafetyPolicySchema } from "../src/modules/ingestion-core/domain/source-safety-policy-schema.ts";
import { BOOTSTRAP_SOURCE_SAFETY_POLICY } from "../src/modules/ingestion-core/domain/safety-engine.ts";

describe("persisted Source safety policy", () => {
  it("accepts actual bootstrap and refuses non-finite/string booleans/invalid ranges", () => {
    expect(sourceSafetyPolicySchema.parse(BOOTSTRAP_SOURCE_SAFETY_POLICY)).toEqual(BOOTSTRAP_SOURCE_SAFETY_POLICY);
    for (const patch of [{ maxDropPercent: Number.NaN }, { maxDropPercent: 101 }, { allowEmpty: "false" },
      { inactiveAfterMissingGoodRuns: 0 }, { maxRawArtifactBytes: 300 * 1024 * 1024 }, { minRecordCount: 10, maxRecordCount: 5 }]) {
      expect(sourceSafetyPolicySchema.safeParse({ ...BOOTSTRAP_SOURCE_SAFETY_POLICY, ...patch }).success).toBe(false);
    }
  });
});
