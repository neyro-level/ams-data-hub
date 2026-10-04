import { describe, expect, it } from "vitest";
import {
  createSourceInputSchema,
  endpointCredentialRefNameSchema,
  isSourceEligibleForAutomaticRun,
  updateSourceInputSchema,
} from "../src/modules/ingestion-core/index.ts";

const base = {
  organizationId: "organization-1",
  projectId: "project-1",
  sourceKey: "mixed-realty",
  name: "Neutral mixed realty",
  endpointCredentialRef: "PROJECT_FEED_ENDPOINT",
  adapterKey: "yrl-realty-2010",
  adapterVersion: "1.0.0",
  profileKey: "neutral-v1",
  profileVersion: "1.0.0",
  datasetType: "MIXED_REALTY" as const,
  transportType: "HTTPS_XML" as const,
  sharingPolicy: "PROJECT_ONLY" as const,
  schedulePolicy: { mode: "MANUAL_ONLY" as const },
  safetyPolicyId: "",
  expectedNamespace: "urn:example:yrl",
  expectedProducer: "Synthetic producer",
};

describe("source registry contract", () => {
  it("accepts only SecretRef names and never a feed URL value", () => {
    expect(createSourceInputSchema.parse(base)).toEqual(base);
    expect(endpointCredentialRefNameSchema.parse("PROJECT_FEED_ENDPOINT")).toBe("PROJECT_FEED_ENDPOINT");
    expect(() => createSourceInputSchema.parse({ ...base, endpointCredentialRef: "https://feed.example.test/private.xml" })).toThrow();
    expect(() => updateSourceInputSchema.parse({ ...base, sourceId: "source-1", version: 1, endpointCredentialRef: "synthetic-secret" })).toThrow();
  });

  it("keeps disabled and manual-only sources out of automatic scheduling", () => {
    expect(isSourceEligibleForAutomaticRun({ enabled: false, schedulePolicy: { mode: "SCHEDULED", cadenceMinutes: 60 } })).toBe(false);
    expect(isSourceEligibleForAutomaticRun({ enabled: true, schedulePolicy: { mode: "MANUAL_ONLY" } })).toBe(false);
    expect(isSourceEligibleForAutomaticRun({ enabled: true, schedulePolicy: { mode: "SCHEDULED", cadenceMinutes: 60 } })).toBe(true);
  });
});
