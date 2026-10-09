import { createHash } from "node:crypto";
import {
  canonicalJsonBytes,
  PROJECT_EXIT_DATASET_KINDS,
  projectExitBundleV1Schema,
  type CanonicalJsonValue,
} from "@ams-data-hub/data-contracts";
import { assertSnapshotPrivacySafe } from "../../snapshot-delivery/index.ts";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { OperationsControlError } from "../contracts.ts";
import type {
  ExitBundleAuditPort,
  ExitBundleContractInput,
  ExitBundleDatasetInput,
  ExitBundleFile,
  ExitBundleMediaInput,
  ExitBundleMediaTransferPort,
  ProtectedConsentAuditPort,
  ProtectedConsentEvidenceInput,
  ProtectedConsentTransferPort,
  ProjectExitBundleComposition,
} from "../domain/exit-bundle.ts";

const SAFE_RELATIVE_PATH = /^(?!\/)(?!.*\.\.)(?!.*\\)[a-zA-Z0-9][a-zA-Z0-9._/-]{0,511}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

function artifact(path: string, body: Uint8Array): ExitBundleFile {
  if (!SAFE_RELATIVE_PATH.test(path)) throw new Error("EXIT_BUNDLE_PATH_UNSAFE");
  return { path, body, sha256: createHash("sha256").update(body).digest("hex"), bytes: body.byteLength };
}

function jsonArtifact(path: string, value: CanonicalJsonValue) {
  return artifact(path, canonicalJsonBytes(value));
}

function documentArtifacts(projectId: string, generatedAt: string) {
  const encode = (value: string) => new TextEncoder().encode(value.replace(/\r\n/gu, "\n"));
  return [
    artifact("docs/HANDOFF.md", encode(`# Project handoff\n\nProject: ${projectId}\nGenerated: ${generatedAt}\nData mode: local\nAMS Hub runtime required: no\n`)),
    artifact("docs/DATA_SCHEMA.md", encode("# Data schema\n\nThe manifest is ProjectExitBundleV1. Dataset files are canonical JSON arrays and vendored contracts are authoritative.\n")),
    artifact("docs/OPERATIONS.md", encode("# Operations\n\nServe local datasets and client-controlled media. Hub polling, webhook and ACK must stay disabled in local mode.\n")),
  ];
}

function assertMedia(media: ExitBundleMediaInput) {
  if (!SAFE_RELATIVE_PATH.test(media.targetPath) || !media.targetPath.startsWith("media/")) throw new Error("EXIT_BUNDLE_MEDIA_PATH_UNSAFE");
  if (!SHA256.test(media.sha256) || !Number.isInteger(media.bytes) || media.bytes < 0) throw new Error("EXIT_BUNDLE_MEDIA_INTEGRITY_INVALID");
  const url = new URL(media.targetUrl);
  if (url.protocol !== "https:") throw new Error("EXIT_BUNDLE_MEDIA_URL_UNSAFE");
}

export async function composeProjectExitBundle(input: {
  projectId: string;
  generatedAt: string;
  schemaMinor?: number;
  datasets: readonly ExitBundleDatasetInput[];
  media: readonly ExitBundleMediaInput[];
  vendoredContracts: readonly ExitBundleContractInput[];
  mediaTransfer: ExitBundleMediaTransferPort;
}): Promise<ProjectExitBundleComposition> {
  const kinds = new Set(input.datasets.map((dataset) => dataset.kind));
  if (input.datasets.length !== PROJECT_EXIT_DATASET_KINDS.length || kinds.size !== PROJECT_EXIT_DATASET_KINDS.length
    || PROJECT_EXIT_DATASET_KINDS.some((kind) => !kinds.has(kind))) throw new Error("EXIT_BUNDLE_DATASET_SET_INVALID");
  if (input.vendoredContracts.length === 0) throw new Error("EXIT_BUNDLE_CONTRACT_REQUIRED");
  if (new Set(input.vendoredContracts.map((item) => item.path)).size !== input.vendoredContracts.length
    || input.vendoredContracts.some((item) => !item.path.startsWith("contracts/"))) throw new Error("EXIT_BUNDLE_CONTRACT_SET_INVALID");
  if (new Set(input.media.map((item) => item.targetPath)).size !== input.media.length) throw new Error("EXIT_BUNDLE_MEDIA_SET_INVALID");

  const datasetsByKind = new Map(input.datasets.map((dataset) => [dataset.kind, dataset] as const));
  const datasetFiles = PROJECT_EXIT_DATASET_KINDS.map((kind) => {
    const dataset = datasetsByKind.get(kind)!;
    dataset.records.forEach((record, index) => assertSnapshotPrivacySafe(record, `$exit.${dataset.kind}[${index}]`));
    return { kind: dataset.kind, count: dataset.records.length, file: jsonArtifact(`data/${dataset.kind}.json`, [...dataset.records]) };
  });

  for (const item of input.media) {
    assertMedia(item);
    await input.mediaTransfer.copy({ sourceStorageKey: item.sourceStorageKey, targetPath: item.targetPath, expectedSha256: item.sha256, expectedBytes: item.bytes, contentType: item.contentType });
  }
  const mediaManifest = jsonArtifact("media/manifest.json", input.media.map((item) => ({ path: item.targetPath, url: item.targetUrl, sha256: item.sha256, bytes: item.bytes, contentType: item.contentType })));
  assertSnapshotPrivacySafe(JSON.parse(new TextDecoder().decode(mediaManifest.body)) as CanonicalJsonValue, "$exit.media");

  const contractFiles = input.vendoredContracts.map((item) => artifact(item.path, item.body));
  const documents = documentArtifacts(input.projectId, input.generatedAt);
  const manifest = projectExitBundleV1Schema.parse({
    schemaMajor: 1,
    schemaMinor: input.schemaMinor ?? 1,
    projectId: input.projectId,
    generatedAt: input.generatedAt,
    dataMode: "local",
    publicOnly: true,
    datasets: datasetFiles.map(({ kind, count, file }) => ({ kind, count, path: file.path, sha256: file.sha256, bytes: file.bytes })),
    mediaManifest: { path: mediaManifest.path, sha256: mediaManifest.sha256, bytes: mediaManifest.bytes },
    vendoredContracts: contractFiles.map((file) => ({ path: file.path, sha256: file.sha256, bytes: file.bytes })),
    documents: {
      handoff: { path: documents[0]!.path, sha256: documents[0]!.sha256, bytes: documents[0]!.bytes },
      dataSchema: { path: documents[1]!.path, sha256: documents[1]!.sha256, bytes: documents[1]!.bytes },
      operations: { path: documents[2]!.path, sha256: documents[2]!.sha256, bytes: documents[2]!.bytes },
    },
    protectedConsentEvidenceIncluded: false,
    requiresAmsHubRuntime: false,
    requiresAmsStorageRuntime: false,
  });
  const manifestFile = jsonArtifact("manifest.json", manifest as CanonicalJsonValue);
  return { manifest, files: [manifestFile, ...datasetFiles.map(({ file }) => file), mediaManifest, ...contractFiles, ...documents] };
}

export async function createProjectExitBundle(
  principal: PrincipalContext,
  input: Parameters<typeof composeProjectExitBundle>[0],
  dependencies: { audit: ExitBundleAuditPort },
) {
  if (principal.kind !== "platform-admin") throw new OperationsControlError("OPERATIONS_CONTROL_ADMIN_ACCESS_DENIED");
  const composition = await composeProjectExitBundle(input);
  const manifestFile = composition.files.find((file) => file.path === "manifest.json");
  if (!manifestFile) throw new Error("EXIT_BUNDLE_MANIFEST_MISSING");
  await dependencies.audit.record({ projectId: input.projectId, actorId: principal.userId, correlationId: principal.correlationId, manifestSha256: manifestFile.sha256, generatedAt: input.generatedAt });
  return composition;
}

export function validateProjectExitBundle(composition: ProjectExitBundleComposition) {
  const manifest = projectExitBundleV1Schema.parse(composition.manifest);
  const files = new Map(composition.files.map((file) => [file.path, file]));
  const manifestFile = files.get("manifest.json");
  const expectedManifestBody = canonicalJsonBytes(manifest as CanonicalJsonValue);
  if (!manifestFile || !Buffer.from(manifestFile.body).equals(Buffer.from(expectedManifestBody))) {
    throw new Error("EXIT_BUNDLE_MANIFEST_MISMATCH");
  }
  const declared = [...manifest.datasets, manifest.mediaManifest, ...manifest.vendoredContracts, manifest.documents.handoff, manifest.documents.dataSchema, manifest.documents.operations];
  for (const expected of declared) {
    const file = files.get(expected.path);
    if (!file || file.sha256 !== expected.sha256 || file.bytes !== expected.bytes) throw new Error("EXIT_BUNDLE_ARTIFACT_MISMATCH");
    if (createHash("sha256").update(file.body).digest("hex") !== expected.sha256 || file.body.byteLength !== expected.bytes) throw new Error("EXIT_BUNDLE_ARTIFACT_MISMATCH");
  }
  return manifest;
}

export async function createProtectedConsentEvidenceExport(
  principal: PrincipalContext,
  input: ProtectedConsentEvidenceInput,
  dependencies: { transfer: ProtectedConsentTransferPort; audit: ProtectedConsentAuditPort },
) {
  if (principal.kind !== "platform-admin") throw new OperationsControlError("OPERATIONS_CONTROL_ADMIN_ACCESS_DENIED");
  if (!input.projectId.trim() || !input.legalBasisReference.trim() || input.entries.length === 0) throw new Error("CONSENT_EXPORT_INPUT_INVALID");
  const payload: CanonicalJsonValue = {
    schemaMajor: 1,
    schemaMinor: 0,
    projectId: input.projectId,
    generatedAt: input.generatedAt,
    legalBasisReference: input.legalBasisReference,
    entries: input.entries.map((entry) => ({ ...entry })),
  };
  const body = canonicalJsonBytes(payload);
  const sha256 = createHash("sha256").update(body).digest("hex");
  const receipt = await dependencies.transfer.write({ projectId: input.projectId, body, sha256 });
  await dependencies.audit.record({ projectId: input.projectId, actorId: principal.userId, correlationId: principal.correlationId, sha256, entryCount: input.entries.length, receiptId: receipt.receiptId });
  return { sha256, bytes: body.byteLength, entryCount: input.entries.length, receiptId: receipt.receiptId };
}
