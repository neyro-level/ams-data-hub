import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  analyzeImportSafety,
  normalizeArea,
  parseYrl2010,
  type YrlRawElement,
  type YrlRawOffer,
} from "../src/modules/ingestion-core/index.ts";
import {
  runSourceImport,
  type GoodRevisionReceipt,
  type ImportPipelineDependencies,
} from "../src/modules/ingestion-core/application/import-pipeline.ts";

const NAMESPACE = "http://webmaster.yandex.ru/schemas/feed/realty/2010-06";
const TARGET = { organizationId: "org-neutral", projectId: "project-neutral", sourceId: "source-neutral" };

interface NeutralInventory {
  externalId: string;
  price: number;
  areaM2: number;
}

function feed(offers: readonly { id: string; price: number; area: number }[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<realty-feed xmlns="${NAMESPACE}">${offers.map((offer) => `
  <offer internal-id="${offer.id}">
    <price><value>${offer.price}</value><currency>RUB</currency></price>
    <area><value>${offer.area}</value><unit>кв. м</unit></area>
  </offer>`).join("")}
</realty-feed>`;
}

function child(element: YrlRawElement, name: string): YrlRawElement {
  const value = element.children.find((candidate) => candidate.localName === name);
  if (!value) throw new Error("YRL_REQUIRED_FIELD_MISSING");
  return value;
}

function offerValue(offer: YrlRawOffer, parent: string, name: string): string {
  return child(child(offer.element, parent), name).text.trim();
}

async function parse(raw: string): Promise<YrlRawOffer[]> {
  const offers: YrlRawOffer[] = [];
  for await (const offer of parseYrl2010([raw], { expectedNamespace: NAMESPACE })) {
    offers.push(offer);
  }
  return offers;
}

function normalize(offers: readonly YrlRawOffer[]): NeutralInventory[] {
  return offers.map((offer) => {
    const externalId = offer.element.attributes.find((attribute) => attribute.localName === "internal-id")?.value;
    if (!externalId) throw new Error("YRL_REQUIRED_FIELD_MISSING");
    return {
      externalId,
      price: Number(offerValue(offer, "price", "value")),
      areaM2: normalizeArea(offerValue(offer, "area", "value"), offerValue(offer, "area", "unit")).value,
    };
  });
}

function dependencies(state: {
  raw: string;
  previousGoodCount: number | null;
  lastGood: GoodRevisionReceipt | null;
  applied: number;
  snapshots: number;
}): ImportPipelineDependencies<string, YrlRawOffer[], NeutralInventory[], NeutralInventory[]> {
  return {
    safeIntake: { acquire: async () => state.raw },
    rawArtifactStore: {
      put: async (_target, raw) => ({
        storageKey: `raw/${createHash("sha256").update(raw).digest("hex")}`,
        rawArtifactHash: createHash("sha256").update(raw).digest("hex"),
        byteCount: Buffer.byteLength(raw),
      }),
    },
    parser: { parse },
    validator: { validate: async () => undefined },
    normalizer: { normalize: async (offers) => normalize(offers) },
    identityResolver: { resolve: async (inventory) => inventory },
    safetyAnalyzer: {
      analyze: async (inventory) => analyzeImportSafety({
        recordCount: inventory.length,
        previousGoodRecordCount: state.previousGoodCount,
        invalidRecordCount: 0,
        issues: [],
      }),
    },
    stagingStore: {
      write: async (inventory) => ({ stagingId: "neutral-stage", entityCount: inventory.length }),
    },
    mutationPlanner: {
      plan: async (staging) => ({
        createCount: staging.entityCount,
        updateCount: 0,
        deactivateCount: Math.max(0, (state.previousGoodCount ?? 0) - staging.entityCount),
        payload: staging,
      }),
    },
    repository: {
      recordAttemptStarted: async () => undefined,
      recordFailure: async () => undefined,
      applyGoodRevision: async ({ staging }) => {
        state.applied += 1;
        state.previousGoodCount = staging.entityCount;
        state.lastGood = { revisionId: `neutral-${state.applied}`, sequence: state.applied };
        return state.lastGood;
      },
    },
    snapshotTrigger: {
      request: async () => {
        state.snapshots += 1;
      },
    },
  };
}

describe("ingestion core synthetic end-to-end", () => {
  it("reaches GOOD and snapshot while empty, truncated and mass-drop feeds preserve Last Good", async () => {
    const state = {
      raw: feed([
        { id: "neutral-1", price: 5_000_000, area: 50 },
        { id: "neutral-2", price: 7_500_000, area: 75 },
      ]),
      previousGoodCount: null as number | null,
      lastGood: null as GoodRevisionReceipt | null,
      applied: 0,
      snapshots: 0,
    };
    const pipeline = dependencies(state);

    await expect(runSourceImport(TARGET, pipeline)).resolves.toMatchObject({
      state: "GOOD",
      sequence: 1,
      snapshotTriggered: true,
    });
    expect(state.lastGood).toEqual({ revisionId: "neutral-1", sequence: 1 });
    expect(state.snapshots).toBe(1);
    const lastGood = state.lastGood;

    state.raw = feed([]);
    await expect(runSourceImport(TARGET, dependencies(state))).resolves.toMatchObject({
      state: "FAILED",
      failedStage: "SAFETY_ANALYSIS",
      code: "IMPORT_REJECTED_BY_SAFETY_POLICY",
    });
    expect(state.lastGood).toBe(lastGood);

    state.raw = `<realty-feed xmlns="${NAMESPACE}"><offer internal-id="broken">`;
    await expect(runSourceImport(TARGET, dependencies(state))).resolves.toMatchObject({
      state: "FAILED",
      failedStage: "PARSE",
      code: "YRL_XML_MALFORMED",
    });
    expect(state.lastGood).toBe(lastGood);

    state.raw = feed([{ id: "neutral-1", price: 5_000_000, area: 50 }]);
    await expect(runSourceImport(TARGET, dependencies(state))).resolves.toMatchObject({
      state: "FAILED",
      failedStage: "SAFETY_ANALYSIS",
      code: "IMPORT_REQUIRES_APPROVAL",
    });
    expect(state.lastGood).toBe(lastGood);
    expect(state.applied).toBe(1);
    expect(state.snapshots).toBe(1);
  });
});
