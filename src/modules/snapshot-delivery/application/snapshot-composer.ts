import { canonicalJson, canonicalJsonBytes, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  SNAPSHOT_DATASET_KINDS,
  unsignedSnapshotManifestV1Schema,
  type ComposeSnapshotInput,
  type SnapshotComposition,
  type SnapshotDatasetInput,
  type SnapshotFileArtifact,
  type SnapshotRecordInput,
} from "../contracts.ts";
import { assertSnapshotPrivacySafe } from "../domain/privacy-scanner.ts";
import { SnapshotCompositionError } from "../domain/snapshot-error.ts";

function sortRecords(records: readonly SnapshotRecordInput[]): SnapshotRecordInput[] {
  return [...records].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
}

function normalizeGzipHeader(body: Uint8Array): Uint8Array {
  const normalized = Uint8Array.from(body);
  normalized.fill(0, 4, 8);
  normalized[9] = 255;
  return normalized;
}

function gzipCanonicalJson(value: CanonicalJsonValue): Uint8Array {
  return normalizeGzipHeader(gzipSync(canonicalJsonBytes(value), { level: 9 }));
}

function sha256(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

function indexDatasets(datasets: readonly SnapshotDatasetInput[]): Map<string, SnapshotRecordInput> {
  const index = new Map<string, SnapshotRecordInput>();
  const kinds = new Set<string>();
  for (const dataset of datasets) {
    if (kinds.has(dataset.kind)) throw new SnapshotCompositionError("SNAPSHOT_DATASET_DUPLICATE", dataset.kind);
    kinds.add(dataset.kind);
    for (const record of dataset.records) {
      const indexKey = `${dataset.kind}\0${record.key}`;
      if (index.has(indexKey)) throw new SnapshotCompositionError("SNAPSHOT_RECORD_DUPLICATE", `${dataset.kind}:${record.key}`);
      index.set(indexKey, record);
    }
  }
  return index;
}

function assertReferences(datasets: readonly SnapshotDatasetInput[], index: ReadonlyMap<string, SnapshotRecordInput>): void {
  for (const dataset of datasets) {
    for (const record of dataset.records) {
      for (const reference of record.references ?? []) {
        if (!index.has(`${reference.kind}\0${reference.key}`)) {
          throw new SnapshotCompositionError(
            "SNAPSHOT_REFERENCE_BROKEN",
            `${dataset.kind}:${record.key}->${reference.kind}:${reference.key}`,
          );
        }
      }
    }
  }
}

function composeDataset(dataset: SnapshotDatasetInput): SnapshotFileArtifact {
  const records = sortRecords(dataset.records);
  const values = records.map((record) => record.value);
  values.forEach((value, index) => assertSnapshotPrivacySafe(value, `${dataset.kind}[${index}]`));
  const body = gzipCanonicalJson(values);
  const digest = sha256(body);
  return {
    body,
    manifest: {
      kind: dataset.kind,
      key: `${dataset.kind}.${digest}.json.gz`,
      sha256: digest,
      bytes: body.byteLength,
      count: records.length,
    },
  };
}

export function composeSnapshot(input: ComposeSnapshotInput): SnapshotComposition {
  const datasetIndex = indexDatasets(input.datasets);
  for (const kind of SNAPSHOT_DATASET_KINDS) {
    if (!input.datasets.some((dataset) => dataset.kind === kind)) {
      throw new SnapshotCompositionError("SNAPSHOT_DATASET_MISSING", kind);
    }
  }
  assertReferences(input.datasets, datasetIndex);
  if (input.requiresProjectContact && !datasetIndex.has(`project/contacts\0${input.projectId}`)) {
    throw new SnapshotCompositionError("SNAPSHOT_PROJECT_CONTACT_REQUIRED", input.projectId);
  }

  const byKind = new Map(input.datasets.map((dataset) => [dataset.kind, dataset] as const));
  const files = SNAPSHOT_DATASET_KINDS
    .filter((kind) => byKind.has(kind))
    .map((kind) => composeDataset(byKind.get(kind)!));

  const manifest = unsignedSnapshotManifestV1Schema.parse({
    schemaMajor: 1,
    schemaMinor: input.schemaMinor,
    projectId: input.projectId,
    publishSequence: input.publishSequence,
    generatedAt: input.generatedAt,
    publishedAt: input.publishedAt,
    catalogRevision: input.catalogRevision,
    sourceRevisions: [...new Set(input.sourceRevisions)].sort((left, right) => left < right ? -1 : left > right ? 1 : 0),
    files: files.map((file) => file.manifest),
    keyId: input.keyId,
  });

  return {
    manifest,
    manifestPayload: canonicalJsonBytes(manifest as CanonicalJsonValue),
    files,
  };
}

export function snapshotManifestCanonicalJson(composition: SnapshotComposition): string {
  return canonicalJson(composition.manifest as CanonicalJsonValue);
}
