import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

const root = process.argv[2];
if (!root || !isAbsolute(root)) throw new Error("LOCAL_BUNDLE_ROOT_REQUIRED");
if (process.env.DATA_MODE !== "local") throw new Error("LOCAL_DATA_MODE_REQUIRED");
if (process.env.HUB_ENABLED !== "false") throw new Error("HUB_MUST_BE_OFF");

const credentialNames = Object.keys(process.env).filter((name) =>
  /^(?:AMS_|AWS_|S3_|DATABASE_|PROJECT_STORAGE_|PROJECT_SNAPSHOT_|SOURCE_)/u.test(name));
if (credentialNames.length !== 0) throw new Error("AMS_CREDENTIALS_MUST_BE_ABSENT");

const expectedKinds = [
  "geo", "developers", "developments", "buildings", "prices", "media", "inventory",
  "agents", "project/contacts", "editorial", "urls", "redirects", "lifecycle",
];
const bytes = async (path) => readFile(join(root, ...path.split("/")));
const digest = (body) => createHash("sha256").update(body).digest("hex");
const manifest = JSON.parse((await bytes("manifest.json")).toString("utf8"));
if (manifest.schemaMajor !== 1 || manifest.schemaMinor !== 1 || manifest.dataMode !== "local")
  throw new Error("LOCAL_MANIFEST_VERSION_INVALID");
if (!manifest.publicOnly || manifest.requiresAmsHubRuntime || manifest.requiresAmsStorageRuntime)
  throw new Error("LOCAL_MANIFEST_RUNTIME_INVALID");
if (manifest.protectedConsentEvidenceIncluded) throw new Error("LOCAL_MANIFEST_PRIVACY_INVALID");
if (!Array.isArray(manifest.datasets) || manifest.datasets.length !== expectedKinds.length
  || manifest.datasets.some((item, index) => item.kind !== expectedKinds[index]))
  throw new Error("LOCAL_DATASET_SET_INVALID");

const declared = [
  ...manifest.datasets,
  manifest.mediaManifest,
  ...manifest.vendoredContracts,
  manifest.documents.handoff,
  manifest.documents.dataSchema,
  manifest.documents.operations,
];
for (const item of declared) {
  const body = await bytes(item.path);
  if (body.byteLength !== item.bytes || digest(body) !== item.sha256) throw new Error("LOCAL_ARTIFACT_INTEGRITY_INVALID");
}
for (const dataset of manifest.datasets) {
  const records = JSON.parse((await bytes(dataset.path)).toString("utf8"));
  if (!Array.isArray(records) || records.length !== dataset.count) throw new Error("LOCAL_DATASET_INVALID");
}
for (const contract of manifest.vendoredContracts) JSON.parse((await bytes(contract.path)).toString("utf8"));
const media = JSON.parse((await bytes(manifest.mediaManifest.path)).toString("utf8"));
if (!Array.isArray(media)) throw new Error("LOCAL_MEDIA_MANIFEST_INVALID");
for (const item of media) {
  const body = await bytes(item.path);
  if (body.byteLength !== item.bytes || digest(body) !== item.sha256) throw new Error("LOCAL_MEDIA_INTEGRITY_INVALID");
}

process.stdout.write(`${JSON.stringify({
  dataMode: process.env.DATA_MODE,
  hubEnabled: false,
  projectId: manifest.projectId,
  schemaMajor: manifest.schemaMajor,
  schemaMinor: manifest.schemaMinor,
  datasets: manifest.datasets.length,
  media: media.length,
  amsCredentials: credentialNames.length,
})}\n`);
