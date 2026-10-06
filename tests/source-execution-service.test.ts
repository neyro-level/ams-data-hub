import { describe, expect, it, vi } from "vitest";
import { SourceExecutionService, type SourceExecutionState } from "../src/modules/ingestion-core/application/source-execution-service.ts";
import type { ResolvedSourceExecution } from "../src/modules/ingestion-core/application/source-execution-service.ts";
import type { ProjectJobPrincipal } from "../src/platform/authorization/principal.ts";

const target = { organizationId: "org-synthetic", projectId: "project-synthetic", sourceId: "source-synthetic" };
function state(): SourceExecutionState {
  return {
    source: { ...target, sourceKey: "synthetic", name: "Synthetic", endpointCredentialRefName: "SYNTHETIC_FEED_ENDPOINT",
      adapterKey: "yrl-realty-2010", adapterVersion: "1.0.0", profileKey: "default-v1", profileVersion: "1.0.0",
      datasetType: "MIXED_REALTY", transportType: "HTTPS_XML", sharingPolicy: "PROJECT_ONLY",
      schedulePolicy: { mode: "MANUAL_ONLY" }, safetyPolicyId: null, enabled: true,
      lastAttemptAt: null, lastSuccessAt: null, lastGoodRevisionId: null, expectedNamespace: null, expectedProducer: null,
      pendingManualRuns: 0, version: 1, updatedAt: new Date() },
    serviceState: "ACTIVE", safetyPolicy: null, lastGood: null,
  };
}

describe("SourceExecutionService application orchestration", () => {
  it("loads by scoped IDs and resolves registered descriptors, safe reference and bootstrap policy", async () => {
    const load = vi.fn<(principal: ProjectJobPrincipal, sourceId: string) => Promise<SourceExecutionState>>(async () => state());
    const run = vi.fn<(context: ResolvedSourceExecution) => Promise<import("../src/modules/ingestion-core/application/import-pipeline.ts").SourceImportResult>>(async () => ({ state: "FAILED", sourceId: target.sourceId, failedStage: "PARSE", code: "SYNTHETIC_PARSER_FAILURE" }));
    await new SourceExecutionService({ load, run }).run(target);
    expect(load.mock.calls[0]).toMatchObject([{ kind: "project-job", organizationId: target.organizationId, projectId: target.projectId }, target.sourceId]);
    expect(run.mock.calls[0]).toMatchObject([{ adapter: { key: "yrl-realty-2010" }, profile: { key: "default-v1" }, safetyPolicy: { allowEmpty: false }, lastGood: null }]);
    expect(JSON.stringify(run.mock.calls[0]?.[0]?.endpointReference)).toBe('"[SECRET_REF]"');
  });

  it.each([
    ["missing", "SOURCE_EXECUTION_NOT_FOUND"], ["scope", "SOURCE_EXECUTION_SCOPE_MISMATCH"],
    ["disabled", "SOURCE_EXECUTION_DISABLED"], ["blocked", "SOURCE_EXECUTION_PROJECT_BLOCKED"],
    ["adapter", "SOURCE_REGISTRY_ADAPTER_UNKNOWN"], ["policy", "SOURCE_EXECUTION_POLICY_MISSING"],
    ["revision", "SOURCE_EXECUTION_LAST_GOOD_MISSING"], ["credential", "SOURCE_EXECUTION_FAILED"],
  ])("fails closed before intake for %s", async (kind, code) => {
    const current = state();
    if (kind === "scope") current.source.projectId = "other-project";
    if (kind === "disabled") current.source.enabled = false;
    if (kind === "blocked") current.serviceState = "PAUSED";
    if (kind === "adapter") current.source.adapterVersion = "unknown";
    if (kind === "policy") current.source.safetyPolicyId = "missing-policy";
    if (kind === "revision") current.source.lastGoodRevisionId = "missing-revision";
    if (kind === "credential") current.source.endpointCredentialRefName = "https://synthetic.example.test/private.xml";
    const run = vi.fn();
    const result = await new SourceExecutionService({ load: async () => kind === "missing" ? null : current, run }).run(target);
    expect(result).toMatchObject({ state: "FAILED", code });
    expect(run).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("synthetic.example.test");
  });

  it("sanitizes arbitrary errors and rejects URL-shaped identifiers before repository access", async () => {
    const load = vi.fn(async () => { throw new Error("https://synthetic.example.test/private.xml?token=synthetic"); });
    const service = new SourceExecutionService({ load, run: vi.fn() });
    expect(await service.run(target)).toMatchObject({ state: "FAILED", code: "SOURCE_EXECUTION_FAILED" });
    load.mockClear();
    expect(await service.run({ ...target, projectId: "https://synthetic.example.test" })).toMatchObject({ code: "SOURCE_EXECUTION_TARGET_INVALID" });
    expect(load).not.toHaveBeenCalled();
  });

  it("rebuilds returned envelopes, removes extra fields and rejects cross-source results", async () => {
    const returned = { state: "FAILED" as const, sourceId: target.sourceId, failedStage: "PARSE" as const,
      code: "https://synthetic.example.test/private.xml", endpoint: "https://synthetic.example.test" };
    const service = new SourceExecutionService({ load: async () => state(), run: async () => returned });
    expect(await service.run(target)).toEqual({ state: "FAILED", sourceId: target.sourceId, failedStage: "PARSE", code: "SOURCE_EXECUTION_FAILED" });
    returned.sourceId = "other-source";
    expect(await service.run(target)).toMatchObject({ code: "SOURCE_EXECUTION_SCOPE_MISMATCH" });
  });

  it("returns only bounded GOOD metadata and strips arbitrary runtime fields", async () => {
    const returned = { state: "GOOD" as const, sourceId: target.sourceId, revisionId: "revision-synthetic", sequence: 1,
      rawArtifactHash: "a".repeat(64), normalizedContentHash: "b".repeat(64), snapshotTriggered: true,
      endpoint: "https://synthetic.example.test" };
    const service = new SourceExecutionService({ load: async () => state(), run: async () => returned });
    expect(JSON.stringify(await service.run(target))).not.toContain("endpoint");
    returned.revisionId = "https://synthetic.example.test";
    expect(await service.run(target)).toMatchObject({ state: "FAILED", code: "SOURCE_EXECUTION_FAILED" });
  });
});
