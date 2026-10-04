import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  normalizedContentHash,
  runIndependentSourceImports,
  runSourceImport,
  type GoodRevisionReceipt,
  type ImportPipelineDependencies,
  type SourceImportTarget,
} from "../src/modules/ingestion-core/application/import-pipeline.ts";

type Fixture = { offers: Array<{ id: string; price: number }>; generationDate?: string };

function target(sourceId: string): SourceImportTarget {
  return { organizationId: "org-fixture", projectId: "project-fixture", sourceId };
}

function fixtureDependencies(state: {
  lastGood: Map<string, GoodRevisionReceipt>;
  failures: string[];
  applied: string[];
}, rawBySource: Record<string, string>): ImportPipelineDependencies<string, Fixture, Fixture, Fixture> {
  return {
    safeIntake: { acquire: async ({ sourceId }) => rawBySource[sourceId] ?? "" },
    rawArtifactStore: {
      put: async ({ sourceId }, raw) => ({
        storageKey: `raw/${sourceId}/fixture.xml`,
        rawArtifactHash: createHash("sha256").update(raw).digest("hex"),
        byteCount: Buffer.byteLength(raw),
      }),
    },
    parser: {
      parse: async (raw) => {
        if (raw === "BROKEN") throw new Error("YRL_XML_MALFORMED");
        return JSON.parse(raw) as Fixture;
      },
    },
    validator: { validate: async (parsed) => { if (parsed.offers.length === 0) throw new Error("EMPTY_SOURCE_FORBIDDEN"); } },
    normalizer: {
      normalize: async (parsed) => ({ offers: [...parsed.offers].sort((left, right) => left.id.localeCompare(right.id)) }),
    },
    identityResolver: { resolve: async (normalized) => normalized },
    safetyAnalyzer: { analyze: async () => undefined },
    stagingStore: { write: async (resolved, { sourceId }) => ({ stagingId: `stage-${sourceId}`, entityCount: resolved.offers.length }) },
    mutationPlanner: { plan: async (staging) => ({ createCount: staging.entityCount, updateCount: 0, deactivateCount: 0, payload: staging }) },
    repository: {
      recordAttemptStarted: async () => undefined,
      recordFailure: async ({ sourceId }, stage, code) => { state.failures.push(`${sourceId}:${stage}:${code}`); },
      applyGoodRevision: async ({ sourceId }) => {
        const revision = { revisionId: `${sourceId}-revision-${state.applied.length + 1}`, sequence: state.applied.length + 1 };
        state.applied.push(sourceId);
        state.lastGood.set(sourceId, revision);
        return revision;
      },
    },
    snapshotTrigger: { request: async () => undefined },
  };
}

describe("source import pipeline", () => {
  it("keeps Last Good when a later artifact is broken", async () => {
    const state = { lastGood: new Map<string, GoodRevisionReceipt>(), failures: [] as string[], applied: [] as string[] };
    const rawBySource = { alpha: JSON.stringify({ offers: [{ id: "1", price: 10 }], generationDate: "volatile-a" }) };
    const first = await runSourceImport(target("alpha"), fixtureDependencies(state, rawBySource));
    expect(first).toMatchObject({ state: "GOOD", sourceId: "alpha", sequence: 1, snapshotTriggered: true });
    const lastGood = state.lastGood.get("alpha");
    rawBySource.alpha = "BROKEN";
    const broken = await runSourceImport(target("alpha"), fixtureDependencies(state, rawBySource));
    expect(broken).toEqual({ state: "FAILED", sourceId: "alpha", failedStage: "PARSE", code: "YRL_XML_MALFORMED" });
    expect(state.lastGood.get("alpha")).toEqual(lastGood);
    expect(state.applied).toEqual(["alpha"]);
  });

  it("isolates sources and lets a healthy source reach GOOD", async () => {
    const state = { lastGood: new Map<string, GoodRevisionReceipt>(), failures: [] as string[], applied: [] as string[] };
    const rawBySource = {
      broken: "BROKEN",
      healthy: JSON.stringify({ offers: [{ id: "2", price: 20 }] }),
    };
    const results = await runIndependentSourceImports(
      [target("broken"), target("healthy")],
      () => fixtureDependencies(state, rawBySource),
    );
    expect(results.find((result) => result.sourceId === "broken")?.state).toBe("FAILED");
    expect(results.find((result) => result.sourceId === "healthy")?.state).toBe("GOOD");
    expect(state.lastGood.has("broken")).toBe(false);
    expect(state.lastGood.has("healthy")).toBe(true);
  });

  it("separates raw integrity hash from stable normalized content hash", () => {
    const normalizedA = { offers: [{ id: "1", price: 10 }], metadata: { b: 2, a: 1 } };
    const normalizedB = { metadata: { a: 1, b: 2 }, offers: [{ price: 10, id: "1" }] };
    expect(normalizedContentHash(normalizedA)).toBe(normalizedContentHash(normalizedB));
    expect(createHash("sha256").update("raw-a").digest("hex")).not.toBe(normalizedContentHash(normalizedA));
  });
});
