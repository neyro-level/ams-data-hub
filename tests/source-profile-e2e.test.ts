import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createSnapshotVerifier, SNAPSHOT_DATASET_KINDS } from "@ams-data-hub/snapshot-verifier";
import {
  extractVladisAgentEvidence,
  normalizeDescription,
  parseYrl2010,
  type YrlRawElement,
  type YrlRawOffer,
} from "../src/modules/ingestion-core/index.ts";
import {
  runSourceImport,
  type GoodRevisionReceipt,
  type ImportPipelineDependencies,
} from "../src/modules/ingestion-core/application/import-pipeline.ts";
import {
  composeSnapshot,
  signSnapshotManifest,
  type SnapshotDatasetInput,
  type SnapshotSigner,
} from "../src/modules/snapshot-delivery/index.ts";

const namespace = "http://webmaster.yandex.ru/schemas/feed/realty/2010-06";
const target = { organizationId: "org-synthetic", projectId: "project-synthetic", sourceId: "source-synthetic" };

function child(element: YrlRawElement, name: string): YrlRawElement | undefined {
  return element.children.find((candidate) => candidate.localName === name);
}

function text(element: YrlRawElement | undefined): string | undefined {
  return element?.text.normalize("NFKC").trim().replace(/\s+/gu, " ") || undefined;
}

function externalId(offer: YrlRawOffer): string {
  return offer.element.attributes.find((attribute) => attribute.localName === "internal-id")?.value ?? "";
}

interface NormalizedOffer {
  externalId: string;
  category: string;
  addressPublic: string;
  apartmentNumberPrivate?: string;
  descriptionText?: string;
  agentName?: string;
  agentPhone?: string;
}

interface DryRunReport {
  totalOffers: number;
  validOffers: number;
  invalidOffers: number;
  warnings: number;
  countsByPropertyType: Record<string, number>;
  countsByTransactionType: Record<string, number>;
  created: number;
  updated: number;
  unchanged: number;
  candidateInactive: number;
  agentsDetected: number;
  agentsMatched: number;
  ambiguousAgents: number;
  mediaReferences: number;
  cadastralWarnings: number;
  unknownCategories: number;
  suspiciousTextWarnings: number;
  sharedPhoneAmbiguities: number;
  privateApartmentFields: number;
  imageOrderRestrictions: number;
}

describe("sanitized source profile end-to-end", () => {
  it("keeps offer identity stable through runs 2-3 and emits a verified privacy-safe snapshot", async () => {
    const fixtureRoot = new URL("./fixtures/yrl/vladis-vt24/", import.meta.url);
    const fixtureXml = await Promise.all([
      readFile(new URL("apartment-sale.xml", fixtureRoot), "utf8"),
      readFile(new URL("agent-with-photo.xml", fixtureRoot), "utf8"),
    ]);
    const rawRuns = [0, 1, 2].map((run) => fixtureXml.map((xml) => xml.replace(
      "2026-10-04T12:00:00+03:00",
      `2026-10-0${4 + run}T12:00:00+03:00`,
    )));
    const revisions: GoodRevisionReceipt[] = [];
    const identities: string[][] = [];
    const reports: DryRunReport[] = [];
    let currentRun = 0;
    let latestNormalized: NormalizedOffer[] = [];

    const dependencies: ImportPipelineDependencies<readonly string[], YrlRawOffer[], NormalizedOffer[], NormalizedOffer[]> = {
      safeIntake: { acquire: async () => rawRuns[currentRun]! },
      rawArtifactStore: {
        put: async (_scope, raw) => {
          const bytes = raw.join("\n");
          return { storageKey: `synthetic/run-${currentRun + 1}.xml`, rawArtifactHash: createHash("sha256").update(bytes).digest("hex"), byteCount: Buffer.byteLength(bytes) };
        },
      },
      parser: {
        parse: async (raw) => {
          const offers: YrlRawOffer[] = [];
          for (const xml of raw) for await (const offer of parseYrl2010([xml], { expectedNamespace: namespace })) offers.push(offer);
          return offers;
        },
      },
      validator: { validate: async (offers) => { if (offers.length !== 2 || offers.some((offer) => !externalId(offer))) throw new Error("SYNTHETIC_FIXTURE_INVALID"); } },
      normalizer: {
        normalize: async (offers) => {
          latestNormalized = offers.map((offer) => {
            const location = child(offer.element, "location");
            const description = text(child(offer.element, "description"));
            const agent = extractVladisAgentEvidence(offer);
            return {
              externalId: externalId(offer),
              category: text(child(offer.element, "category")) ?? "unknown",
              addressPublic: text(child(location!, "address")) ?? "Тестоград",
              ...(text(child(location!, "apartment")) ? { apartmentNumberPrivate: text(child(location!, "apartment")) } : {}),
              ...(description ? { descriptionText: normalizeDescription(description).descriptionText.replace(/^Код объекта:\s*[^.]+\.\s*/u, "") } : {}),
              ...(agent ? { agentName: agent.fullNameRaw, agentPhone: agent.phoneRaw } : {}),
            };
          }).sort((left, right) => left.externalId.localeCompare(right.externalId));
          identities.push(latestNormalized.map((offer) => offer.externalId));
          return latestNormalized;
        },
      },
      identityResolver: { resolve: async (normalized) => normalized },
      safetyAnalyzer: { analyze: async () => undefined },
      stagingStore: { write: async (resolved) => ({ stagingId: `stage-${currentRun + 1}`, entityCount: resolved.length }) },
      mutationPlanner: {
        plan: async (staging) => {
          const report: DryRunReport = {
            totalOffers: latestNormalized.length, validOffers: latestNormalized.length, invalidOffers: 0, warnings: 0,
            countsByPropertyType: { APARTMENT: latestNormalized.length }, countsByTransactionType: { SALE: latestNormalized.length },
            created: currentRun === 0 ? latestNormalized.length : 0, updated: 0, unchanged: currentRun === 0 ? 0 : latestNormalized.length,
            candidateInactive: 0, agentsDetected: latestNormalized.filter((offer) => offer.agentName).length, agentsMatched: 0,
            ambiguousAgents: 0, mediaReferences: 3, cadastralWarnings: 0, unknownCategories: 0, suspiciousTextWarnings: 0,
            sharedPhoneAmbiguities: 0, privateApartmentFields: latestNormalized.filter((offer) => offer.apartmentNumberPrivate).length,
            imageOrderRestrictions: 1,
          };
          reports.push(report);
          return { createCount: report.created, updateCount: report.updated, deactivateCount: 0, payload: { staging, report } };
        },
      },
      repository: {
        recordAttemptStarted: async () => undefined,
        recordFailure: async () => undefined,
        applyGoodRevision: async () => {
          const revision = { revisionId: `synthetic-revision-${currentRun + 1}`, sequence: currentRun + 1 };
          revisions.push(revision);
          return revision;
        },
      },
      snapshotTrigger: { request: async () => undefined },
    };

    const runs = [];
    for (currentRun = 0; currentRun < 3; currentRun += 1) runs.push(await runSourceImport(target, dependencies));
    expect(runs.every((run) => run.state === "GOOD")).toBe(true);
    expect(identities[1]).toEqual(identities[0]);
    expect(identities[2]).toEqual(identities[0]);
    expect(reports.map((report) => report.candidateInactive)).toEqual([0, 0, 0]);
    expect(reports[0]).toMatchObject({ totalOffers: 2, validOffers: 2, privateApartmentFields: 1, imageOrderRestrictions: 1 });

    const datasets: SnapshotDatasetInput[] = SNAPSHOT_DATASET_KINDS.map((kind) => ({ kind, records: [] }));
    datasets.find((dataset) => dataset.kind === "project/contacts")!.records = [{ key: target.projectId, value: { phone: "+70000000000" } }];
    datasets.find((dataset) => dataset.kind === "inventory")!.records = latestNormalized.map((offer, index) => ({
      key: `inventory-${index + 1}`,
      value: {
        uid: `inventory-${index + 1}`,
        publicUrlId: `public-${index + 1}`,
        propertyType: "APARTMENT",
        transactionType: "SALE",
        addressPublic: offer.addressPublic,
        descriptionText: offer.descriptionText ?? "",
        media: [{ assetId: `asset-${index + 1}`, url: `/media/asset-${index + 1}` }],
        status: "ACTIVE",
      },
    }));
    const keys = generateKeyPairSync("ed25519");
    const signer: SnapshotSigner = { keyId: "synthetic-key", async sign(payload) { return Uint8Array.from(sign(null, payload, keys.privateKey)); } };
    const composition = composeSnapshot({
      schemaMinor: 0,
      projectId: target.projectId,
      publishSequence: 3,
      generatedAt: "2026-10-05T03:00:00.000Z",
      publishedAt: "2026-10-05T03:00:01.000Z",
      catalogRevision: "synthetic-catalog-1",
      sourceRevisions: revisions.map((revision) => revision.revisionId),
      keyId: signer.keyId,
      requiresProjectContact: true,
      datasets,
    });
    const manifest = await signSnapshotManifest(composition, signer);
    const files = Object.fromEntries(composition.files.map((file) => [file.manifest.key, file.body]));
    const schemas = Object.fromEntries(SNAPSHOT_DATASET_KINDS.map((kind) => [kind, z.array(z.unknown())])) as unknown as Record<(typeof SNAPSHOT_DATASET_KINDS)[number], z.ZodType<readonly unknown[]>>;
    const verifier = createSnapshotVerifier({ datasetSchemas: schemas, validateReferences: () => true });
    const verified = verifier({
      manifest,
      files,
      trustSet: { currentKeyId: signer.keyId, nextKeyId: null, publicKeys: { [signer.keyId]: keys.publicKey.export({ format: "pem", type: "spki" }).toString() }, revokedKeyIds: [] },
      expectedProjectId: target.projectId,
      supportedSchemaMajor: 1,
      lastGood: { projectId: target.projectId, schemaMajor: 1, publishSequence: 2 },
    });
    expect(verified).toMatchObject({ accepted: true, nextState: { publishSequence: 3 } });
    const publicPayload = JSON.stringify(verified.accepted ? verified.datasets : {});
    expect(publicPayload).not.toContain("42-ТЕСТ");
    expect(publicPayload).not.toContain("79590000001");
    expect(publicPayload).not.toMatch(/<\/?[a-z][^>]*>/iu);
    expect(publicPayload).not.toContain("synthetic-agent-photo-1");
  });
});
