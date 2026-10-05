import { PROJECT_EXIT_DATASET_KINDS, dataModeSchema, projectExitBundleV1Schema } from "@ams-data-hub/data-contracts";
import { describe, expect, it } from "vitest";

const digest = "a".repeat(64);
const artifact = (path: string) => ({ path, sha256: digest, bytes: 1 });
const bundle = {
  schemaMajor: 1, schemaMinor: 0, projectId: "project-1", generatedAt: "2026-10-05T00:00:00.000Z",
  dataMode: "local", publicOnly: true,
  datasets: PROJECT_EXIT_DATASET_KINDS.map((kind) => ({ ...artifact(`data/${kind}.json`), kind, count: 0 })),
  mediaManifest: artifact("media/manifest.json"),
  vendoredContracts: [artifact("contracts/snapshot-v1.schema.json")],
  documents: { handoff: artifact("docs/HANDOFF.md"), dataSchema: artifact("docs/DATA_SCHEMA.md"), operations: artifact("docs/OPERATIONS.md") },
  protectedConsentEvidenceIncluded: false, requiresAmsHubRuntime: false, requiresAmsStorageRuntime: false,
} as const;

describe("ProjectExitBundleV1 portability contract", () => {
  it("accepts a complete public local-mode skeleton and both runtime modes", () => {
    expect(projectExitBundleV1Schema.parse(bundle)).toMatchObject({ dataMode: "local", publicOnly: true });
    expect(dataModeSchema.options).toEqual(["hub", "local"]);
  });
  it("rejects missing datasets, unsafe paths and any AMS runtime dependency", () => {
    expect(projectExitBundleV1Schema.safeParse({ ...bundle, datasets: bundle.datasets.slice(1) }).success).toBe(false);
    expect(projectExitBundleV1Schema.safeParse({ ...bundle, mediaManifest: artifact("../private") }).success).toBe(false);
    expect(projectExitBundleV1Schema.safeParse({ ...bundle, requiresAmsHubRuntime: true }).success).toBe(false);
  });
  it("keeps consent evidence outside the public bundle", () => {
    expect(projectExitBundleV1Schema.safeParse({ ...bundle, protectedConsentEvidenceIncluded: true }).success).toBe(false);
  });
});
