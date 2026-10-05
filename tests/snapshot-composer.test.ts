import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  composeSnapshot,
  projectPublicCoordinates,
  SNAPSHOT_DATASET_KINDS,
  snapshotManifestCanonicalJson,
  SnapshotCompositionError,
  type ComposeSnapshotInput,
  type SnapshotDatasetInput,
} from "../src/modules/snapshot-delivery/index.ts";

const baseInput = (datasets: SnapshotDatasetInput[]): ComposeSnapshotInput => ({
  schemaMinor: 0,
  projectId: "project-1",
  publishSequence: 7,
  generatedAt: "2026-10-05T00:00:00.000Z",
  publishedAt: "2026-10-05T00:00:01.000Z",
  catalogRevision: "catalog-revision-12",
  sourceRevisions: ["source-b", "source-a", "source-b"],
  keyId: "test-key-1",
  requiresProjectContact: true,
  datasets,
});

const safeDatasets = (): SnapshotDatasetInput[] => {
  const populated: Partial<Record<(typeof SNAPSHOT_DATASET_KINDS)[number], SnapshotDatasetInput["records"]>> = {
    "project/contacts": [{ key: "project-1", value: { phone: "+70000000000", email: "public@example.test" } }],
    developers: [
      { key: "developer-b", value: { uid: "developer-b", name: "Бета" } },
      { key: "developer-a", value: { uid: "developer-a", name: "Альфа" } },
    ],
    developments: [{
      key: "development-1",
      value: { uid: "development-1", developerUid: "developer-a", name: "Проект" },
      references: [{ kind: "developers", key: "developer-a" }],
    }],
  };
  return SNAPSHOT_DATASET_KINDS.map((kind) => ({ kind, records: populated[kind] ?? [] }));
};

describe("Snapshot Composer", () => {
  it("creates deterministic gzip datasets and an unsigned canonical manifest", () => {
    const first = composeSnapshot(baseInput(safeDatasets()));
    const shuffled = safeDatasets().reverse().map((dataset) => ({ ...dataset, records: [...dataset.records].reverse() }));
    const second = composeSnapshot(baseInput(shuffled));

    expect(snapshotManifestCanonicalJson(first)).toBe(snapshotManifestCanonicalJson(second));
    expect(Array.from(first.manifestPayload)).toEqual(Array.from(second.manifestPayload));
    expect(first.files.map((file) => Array.from(file.body))).toEqual(second.files.map((file) => Array.from(file.body)));
    expect(first.manifest.sourceRevisions).toEqual(["source-a", "source-b"]);
    expect(first.manifest.files.map((file) => file.kind)).toEqual(SNAPSHOT_DATASET_KINDS);
    expect(first.manifest.files.every((file) => file.key === `${file.kind}.${file.sha256}.json.gz`)).toBe(true);
    const developers = first.files.find((file) => file.manifest.kind === "developers")!;
    expect(JSON.parse(gunzipSync(developers.body).toString("utf8"))).toEqual([
      { name: "Альфа", uid: "developer-a" },
      { name: "Бета", uid: "developer-b" },
    ]);
  });

  it.each([
    ["private apartment", { apartmentNumberPrivate: "12" }],
    ["raw HTML", { description: "<p>raw</p>" }],
    ["feed endpoint", { endpointUrl: "https://feed.example.test" }],
    ["credential reference", { credentialRef: "secret/path" }],
    ["snake case credential", { source_credential_ref: "secret/path" }],
    ["access token", { accessToken: "never" }],
    ["normalized private phone", { phoneNorm: "+70000000000" }],
    ["feed-owned photo reference", { feedPhotoMediaId: "media-private" }],
    ["consent evidence", { consentConfirmedAt: "2026-10-05T00:00:00Z" }],
    ["raw import issue", { rawImportIssuePayload: { code: "x" } }],
    ["source secret", { sourceSecret: "never" }],
  ])("rejects %s before a manifest can be signed", (_name, forbidden) => {
    const datasets = safeDatasets().map((dataset) => dataset.kind === "inventory"
      ? { ...dataset, records: [{ key: "inventory-1", value: { uid: "inventory-1", ...forbidden } }] }
      : dataset);
    expect(() => composeSnapshot(baseInput(datasets))).toThrow(SnapshotCompositionError);
    try {
      composeSnapshot(baseInput(datasets));
    } catch (error) {
      expect((error as SnapshotCompositionError).code).toMatch(/^SNAPSHOT_PRIVACY_/u);
    }
  });

  it("rejects missing references and a required project fallback contact", () => {
    const broken = safeDatasets();
    broken.find((dataset) => dataset.kind === "developments")!.records[0]!.references = [
      { kind: "developers", key: "missing" },
    ];
    expect(() => composeSnapshot(baseInput(broken))).toThrow("SNAPSHOT_REFERENCE_BROKEN");
    const missingContact = safeDatasets().map((dataset) => dataset.kind === "project/contacts" ? { ...dataset, records: [] } : dataset);
    expect(() => composeSnapshot(baseInput(missingContact)))
      .toThrow("SNAPSHOT_PROJECT_CONTACT_REQUIRED");
  });

  it("projects coordinates deterministically across snapshot sequences", () => {
    const location = {
      latitude: 45.03547,
      longitude: 38.975313,
      entityUid: "01JLOCATION000000000000000",
      policyVersion: "v1",
      precision: "STREET" as const,
    };
    const snapshotN = projectPublicCoordinates(location);
    const snapshotNPlusOne = projectPublicCoordinates(location);
    expect(snapshotNPlusOne).toEqual(snapshotN);
    expect(projectPublicCoordinates({ ...location, policyVersion: "v2" })).not.toEqual(snapshotN);
    expect(projectPublicCoordinates({ ...location, precision: "DISTRICT" })).not.toEqual(snapshotN);
    expect(projectPublicCoordinates({ ...location, latitude: 90, longitude: 180 })).toEqual(expect.objectContaining({
      latitude: expect.any(Number),
      longitude: expect.any(Number),
    }));
    expect(projectPublicCoordinates({ ...location, latitude: 90, longitude: 180 }).latitude).toBeLessThanOrEqual(90);
    expect(projectPublicCoordinates({ ...location, precision: "EXACT", latitude: 45.123456789 }).latitude).toBe(45.123456789);
  });
});
