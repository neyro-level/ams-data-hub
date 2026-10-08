import { S3Client } from "@aws-sdk/client-s3";
import { canonicalJsonBytes, createUlid, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { generateKeyPairSync, sign } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { composeSnapshot, signSnapshotManifest, SNAPSHOT_DATASET_KINDS, projectSnapshotInventory,
  type SnapshotDatasetKind, type SnapshotComposition, type SnapshotManifestV1 } from "../src/modules/snapshot-delivery/index.ts";
import { joyworkYandexRealtyProfile } from "../src/modules/ingestion-core/index.ts";
import { readStagedSnapshotArtifacts, readStagedSnapshotComposition } from "../src/modules/snapshot-delivery/infrastructure/snapshot-staged-artifact-reader.ts";
import { calculateObjectSha256, createProjectSnapshotKey } from "../src/platform/storage/object-storage.ts";
import { S3ObjectStorage } from "../src/platform/storage/timeweb-s3-object-storage.ts";

const timestamp = "2026-10-07T00:00:00.000Z";
type Data = Record<SnapshotDatasetKind, CanonicalJsonValue[]>;
const row = (data: Data, kind: SnapshotDatasetKind, index = 0) => data[kind][index] as Record<string, CanonicalJsonValue>;
function publicData(): Data {
  const [region, city, district, developer, development, building, agent, inventory, inactive] = Array.from({ length: 9 }, () => createUlid()) as string[];
  const geo = { name: "Synthetic", normalizedName: "synthetic", lifecycle: "ACTIVE", aliases: [] };
  const media = { ref: "c".repeat(64), kind: "IMAGE", position: 0 };
  const price = { developmentUid: development!, buildingUid: building!, observedAt: timestamp,
    amount: "9000000.99", currency: "RUB", basis: "TOTAL", areaM2: "40.01", roomCount: 0 };
  const profileIdentity = `${joyworkYandexRealtyProfile.key}@${joyworkYandexRealtyProfile.version}`;
  const inventoryDataset = projectSnapshotInventory({ organizationId: "synthetic-org", projectId: "synthetic-project" }, [{
    fact: { inventoryUid: inventory!, sourceId: "synthetic-source", externalOfferId: "synthetic-offer", normalizedHash: "b".repeat(64),
      factProfileIdentity: profileIdentity, draft: { sourceFormat: "YRL_2010", propertyType: "APARTMENT", transactionType: "SALE", areaM2: 40,
        description: "<p>Public <strong>safe</strong> copy</p>" }, addressPublic: "Synthetic public street", fieldValues: {} },
    profile: { identity: profileIdentity, configuration: null, formatContract: joyworkYandexRealtyProfile.formatContract! },
    identity: { uid: inventory!, sourceId: "synthetic-source", externalOfferId: "synthetic-offer", sourceHash: "a".repeat(64), normalizedHash: "b".repeat(64),
      factProfileIdentity: profileIdentity, status: "ACTIVE", firstSeenAt: timestamp, lastSeenAt: timestamp,
      sourceCreatedAt: null, sourceUpdatedAt: null, createdAt: timestamp, updatedAt: timestamp },
    url: { entityType: "INVENTORY", entityUid: inventory!, publicUrlId: "1234567890123456" }, media: [], agentUid: agent!,
  }]);
  return {
    geo: [{ ...geo, entityType: "region", uid: region!, code: "RU-MOW" },
      { ...geo, entityType: "city", uid: city!, regionUid: region! }, { ...geo, entityType: "district", uid: district!, cityUid: city! }],
    developers: [{ uid: developer!, name: "Synthetic", lifecycle: "ACTIVE", aliases: [] }],
    developments: [{ uid: development!, name: "Synthetic", developerUid: developer!, cityUid: city!, districtUid: district!,
      lifecycle: "ACTIVE", aliases: [], addressLine: null, latitude: null, longitude: null }],
    buildings: [{ uid: building!, developmentUid: development!, label: "One", floors: 10, commissioningYear: 2027,
      commissioningQuarter: 2, constructionStatus: "UNDER_CONSTRUCTION", material: null, housingClass: null, lifecycle: "ACTIVE", aliases: [] }],
    prices: [price, { ...price }], media: [{ entityType: "AGENT", entityUid: agent!, media }],
    inventory: inventoryDataset.records.map((record) => record.value),
    agents: [{ uid: agent!, slug: "synthetic-agent", role: "AGENT", fullName: "Synthetic Agent", position: null, bio: null,
      specializations: [], workPhone: null, workEmail: null, messengers: [], sortOrder: 0, media: [media] }],
    "project/contacts": [{ phone: "+70000000002", email: null, addressPublic: null, messengers: [], hours: null }],
    editorial: [{ entityType: "AGENT", entityUid: agent!, shortDescription: "Public", description: null, faq: [],
      mediaOrder: [], isImageOrderChangeAllowed: false }],
    // Original reservation subject differs after legitimate relink.
    urls: [{ factType: "reservation", entityType: "INVENTORY", entityUid: inactive!, publicUrlId: "1234567890123456" },
      { factType: "entry", entityType: "INVENTORY", entityUid: inventory!, publicUrlId: "1234567890123456", slug: "offer",
        canonicalPath: "/offers/newest", factualLifecycle: "ACTIVE", presentationLifecycle: "VISIBLE",
        redirectTargetPath: null, publishedAt: timestamp, retiredAt: null }],
    // Historical target path is not today's canonical path; no invented target check.
    redirects: [{ fromPath: "/offers/oldest", toPath: "/offers/old", code: 301, reason: "SLUG_CHANGE", createdAt: timestamp },
      { fromPath: "/offers/old", toPath: "/offers/newest", code: 301, reason: "SLUG_CHANGE", createdAt: timestamp }],
    lifecycle: [{ factType: "inventory-state", inventoryUid: inactive!, status: "INACTIVE", effectiveAt: timestamp },
      { factType: "inventory-event", inventoryUid: inactive!, type: "INACTIVATED", occurredAt: timestamp },
      { factType: "inventory-event", inventoryUid: inactive!, type: "INACTIVATED", occurredAt: timestamp },
      { factType: "url-tombstone", entityType: "INVENTORY", entityUid: inactive!, publicUrlId: "1234567890123456",
        canonicalPath: "/offers/retired", reason: "RETIRE", createdAt: timestamp }],
  };
}

async function fixture(attack?: (data: Data) => void, changeManifest?: (manifest: SnapshotManifestV1) => void,
  changeFile?: (composition: SnapshotComposition) => void) {
  const data = publicData();
  const composition: SnapshotComposition = composeSnapshot({ schemaMinor: 0, projectId: "synthetic-project", publishSequence: 2,
    generatedAt: timestamp, publishedAt: timestamp, catalogRevision: "synthetic-catalog", sourceRevisions: ["synthetic-good"],
    keyId: "synthetic-key", requiresProjectContact: true,
    datasets: SNAPSHOT_DATASET_KINDS.map((kind) => ({ kind, records: data[kind].map((value, index) => ({
      key: kind === "project/contacts" ? "synthetic-project" : String(index), value })) })),
  });
  // A hostile signer can produce valid signatures on semantically invalid values.
  // Mutate the encoded artifact independently of the legitimate BUILD guard.
  if (attack) {
    attack(data);
    for (const file of composition.files) {
      file.body = gzipSync(canonicalJsonBytes(data[file.manifest.kind]));
      const sha256 = calculateObjectSha256(file.body);
      Object.assign(file.manifest, { sha256, key: `${file.manifest.kind}.${sha256}.json.gz`, bytes: file.body.length, count: data[file.manifest.kind].length });
    }
    composition.manifest.files = composition.files.map((file) => ({ ...file.manifest }));
    composition.manifestPayload = canonicalJsonBytes(composition.manifest as CanonicalJsonValue);
  }
  if (changeFile) {
    changeFile(composition);
    for (const file of composition.files) {
      const sha256 = calculateObjectSha256(file.body);
      Object.assign(file.manifest, { sha256, key: `${file.manifest.kind}.${sha256}.json.gz`, bytes: file.body.length });
    }
    composition.manifest.files = composition.files.map((file) => ({ ...file.manifest }));
    composition.manifestPayload = canonicalJsonBytes(composition.manifest as CanonicalJsonValue);
  }
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signer = { keyId: "synthetic-key", async sign(payload: Uint8Array) { return Uint8Array.from(sign(null, payload, privateKey)); } };
  const manifest = await signSnapshotManifest(composition, signer);
  if (changeManifest) {
    changeManifest(manifest);
    const { signature: _signature, ...unsigned } = manifest; void _signature;
    manifest.signature = Buffer.from(await signer.sign(canonicalJsonBytes(unsigned as CanonicalJsonValue))).toString("base64url");
  }
  const objects = new Map(composition.files.map((file) => [createProjectSnapshotKey("synthetic-project", file.manifest.sha256), file.body]));
  const manifestBytes = canonicalJsonBytes(manifest as CanonicalJsonValue);
  const binding = { projectId: "synthetic-project", publishSequence: 2, keyId: "synthetic-key",
    manifestCanonical: Buffer.from(manifestBytes).toString("utf8"), manifestSha256: calculateObjectSha256(manifestBytes) };
  const manifestKey = createProjectSnapshotKey(binding.projectId, binding.manifestSha256);
  objects.set(manifestKey, manifestBytes);
  const client = new S3Client({ region: "ru-1", credentials: { accessKeyId: "synthetic", secretAccessKey: "synthetic" } });
  const destroyed = vi.fn(); const allocated = vi.fn(); const keys: string[] = [];
  const send = vi.spyOn(client, "send").mockImplementation(async (command) => {
    const input = command.input as { Key: string; Bucket: string }; keys.push(input.Key);
    if (input.Bucket !== "synthetic") throw new Error("SYNTHETIC_BUCKET_INVALID");
    const bytes = objects.get(input.Key);
    if (!bytes) throw { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } };
    return { ContentLength: bytes.length, ContentType: "application/octet-stream", LastModified: new Date(timestamp),
      Body: { destroy: destroyed, transformToByteArray: allocated,
      async *[Symbol.asyncIterator]() { yield bytes.slice(0, 3); yield bytes.slice(3); } } } as never;
  });
  const storage = new S3ObjectStorage({ bucket: "synthetic", client });
  const forbidden = [vi.spyOn(storage, "get"), vi.spyOn(storage, "head"), vi.spyOn(storage, "put"), vi.spyOn(storage, "presignGet")];
  const input = { projectId: binding.projectId, binding, storage,
    trustSet: { currentKeyId: signer.keyId, nextKeyId: null, publicKeys: { [signer.keyId]: publicKey.export({ format: "pem", type: "spki" }).toString() }, revokedKeyIds: [] as string[] },
    lastGood: { projectId: binding.projectId, schemaMajor: 1, publishSequence: 1 } };
  return { data, composition, manifest, objects, binding, manifestKey, send, keys, destroyed, allocated, forbidden, input };
}

describe("selected staged snapshot artifact verification", () => {
  it("retains authenticated compressed bytes for rollback without extra IO or recompression", async () => {
    const f = await fixture();
    const { verified, composition } = await readStagedSnapshotComposition(f.input);
    expect(verified.datasets).toEqual(f.data);
    expect(composition.manifest).toEqual(f.composition.manifest);
    expect(composition.manifestPayload).toEqual(f.composition.manifestPayload);
    expect(composition.files.map((file) => ({ manifest: file.manifest, body: Buffer.from(file.body) })))
      .toEqual(f.composition.files.map((file) => ({ manifest: file.manifest, body: Buffer.from(file.body) })));
    expect(composition.manifest).not.toHaveProperty("signature");
    for (const file of composition.files) {
      expect(calculateObjectSha256(file.body)).toBe(file.manifest.sha256);
      expect(Buffer.from(file.body).equals(f.objects.get(createProjectSnapshotKey(f.binding.projectId, file.manifest.sha256))!)).toBe(true);
    }
    expect(f.keys).toHaveLength(14); expect(f.destroyed).toHaveBeenCalledTimes(14);
    expect(f.allocated).not.toHaveBeenCalled();
    for (const call of f.forbidden) expect(call).not.toHaveBeenCalled();
  });
  it("does not relax revoked consumer key policy for unchanged-file reuse", async () => {
    const f = await fixture(); f.input.trustSet.revokedKeyIds.push("synthetic-key");
    await expect(readStagedSnapshotComposition(f.input)).rejects.toThrow("SNAPSHOT_ARTIFACT_REVOKED_KEY_ID");
    expect(f.keys).toEqual([f.manifestKey]);
  });
  it("does not expose a composition with private dataset fields", async () => {
    const f = await fixture((data) => { row(data, "agents").privateNotes = "synthetic forbidden"; });
    await expect(readStagedSnapshotComposition(f.input)).rejects.toThrow("SNAPSHOT_ARTIFACT_DATASET_SCHEMA_INVALID");
  });
  it("verifies all thirteen strict public datasets through actual bounded S3 reads only", async () => {
    const f = await fixture(); const before = structuredClone(f.manifest);
    const result = await readStagedSnapshotArtifacts(f.input);
    expect(result.accepted).toBe(true); expect(result.datasets).toEqual(f.data);
    expect(f.manifest).toEqual(before); expect(f.keys).toHaveLength(14);
    expect(f.keys.every((key) => key.startsWith("snapshots/synthetic-project/"))).toBe(true);
    expect(f.destroyed).toHaveBeenCalledTimes(14); expect(f.allocated).not.toHaveBeenCalled();
    for (const call of f.forbidden) expect(call).not.toHaveBeenCalled();
  });
  it.each([
    ["revoked", "REVOKED_KEY_ID"], ["unknown", "UNKNOWN_KEY_ID"], ["stale", "STALE_PUBLISH_SEQUENCE"],
  ])("rejects %s trust/sequence before any dataset GET", async (kind, reason) => {
    const f = await fixture();
    if (kind === "revoked") f.input.trustSet.revokedKeyIds.push("synthetic-key");
    if (kind === "unknown") f.input.trustSet.currentKeyId = "new-current-key";
    if (kind === "stale") f.input.lastGood.publishSequence = 2;
    await expect(readStagedSnapshotArtifacts(f.input)).rejects.toThrow(`SNAPSHOT_ARTIFACT_${reason}`);
    expect(f.keys).toEqual([f.manifestKey]);
  });
  it.each([
    ["project", (m: SnapshotManifestV1) => { m.projectId = "foreign-project"; }, "PROJECT_MISMATCH"],
    ["set", (m: SnapshotManifestV1) => { m.files.pop(); }, "DATASET_SET_INVALID"],
    ["count", (m: SnapshotManifestV1) => { m.files[0]!.count = 50_001; }, "SNAPSHOT_LIMIT_EXCEEDED"],
    ["bytes", (m: SnapshotManifestV1) => { m.files[0]!.bytes = 4 * 1024 * 1024 + 1; }, "SNAPSHOT_LIMIT_EXCEEDED"],
    ["foreign-key", (m: SnapshotManifestV1) => { m.files[0]!.key = createProjectSnapshotKey("foreign-project", m.files[0]!.sha256); }, "FILE_KEY_INVALID"],
    ["wrong-kind-key", (m: SnapshotManifestV1) => { m.files[0]!.key = `agents.${m.files[0]!.sha256}.json.gz`; }, "FILE_KEY_INVALID"],
    ["canonical-binding-sequence", (m: SnapshotManifestV1) => { m.publishSequence = 3; }, "BINDING_CONFLICT"],
  ] as const)("rejects signed %s header before dataset IO", async (_kind, mutate, reason) => {
    const f = await fixture(undefined, mutate);
    await expect(readStagedSnapshotArtifacts(f.input)).rejects.toThrow(reason === "BINDING_CONFLICT"
      ? "SNAPSHOT_PUBLICATION_BINDING_CONFLICT" : `SNAPSHOT_ARTIFACT_${reason}`);
    expect(f.keys).toEqual([f.manifestKey]);
  });
  it.each([
    ["extra private field", (d: Data) => { row(d, "agents").privatePhone = "synthetic"; }, "DATASET_SCHEMA_INVALID"],
    ["raw HTML", (d: Data) => { row(d, "developers").name = "<script>synthetic</script>"; }, "DATASET_SCHEMA_INVALID"],
    ["geo kind", (d: Data) => { row(d, "geo", 1).regionUid = row(d, "geo", 2).uid!; }, "REFERENCE_INTEGRITY_INVALID"],
    ["district parent", (d: Data) => { row(d, "geo", 2).cityUid = row(d, "geo").uid!; }, "REFERENCE_INTEGRITY_INVALID"],
    ["developer", (d: Data) => { d.developers = []; }, "REFERENCE_INTEGRITY_INVALID"],
    ["building", (d: Data) => { row(d, "buildings").developmentUid = createUlid(); }, "REFERENCE_INTEGRITY_INVALID"],
    ["price", (d: Data) => { row(d, "prices").buildingUid = createUlid(); }, "REFERENCE_INTEGRITY_INVALID"],
    ["inventory URL", (d: Data) => { row(d, "urls", 1).entityUid = createUlid(); }, "REFERENCE_INTEGRITY_INVALID"],
    ["reservation", (d: Data) => { d.urls.shift(); }, "REFERENCE_INTEGRITY_INVALID"],
    ["editorial", (d: Data) => { row(d, "editorial").entityUid = createUlid(); }, "REFERENCE_INTEGRITY_INVALID"],
    ["media owner", (d: Data) => { row(d, "media").entityUid = createUlid(); }, "REFERENCE_INTEGRITY_INVALID"],
    ["embedded media", (d: Data) => { row(d, "media").media = { ...(row(d, "media").media as Record<string, CanonicalJsonValue>), ref: "f".repeat(64) }; }, "REFERENCE_INTEGRITY_INVALID"],
    ["unembedded media", (d: Data) => { row(d, "agents").media = []; }, "REFERENCE_INTEGRITY_INVALID"],
    ["duplicate geo", (d: Data) => { d.geo.push(d.geo[0]!); }, "REFERENCE_INTEGRITY_INVALID"],
    ["duplicate media", (d: Data) => { d.media.push(d.media[0]!); }, "REFERENCE_INTEGRITY_INVALID"],
    ["duplicate state", (d: Data) => { d.lifecycle.push(d.lifecycle[0]!); }, "REFERENCE_INTEGRITY_INVALID"],
    ["duplicate redirect", (d: Data) => { d.redirects.push(d.redirects[0]!); }, "REFERENCE_INTEGRITY_INVALID"],
    ["contacts", (d: Data) => { d["project/contacts"].push(d["project/contacts"][0]!); }, "DATASET_SCHEMA_INVALID"],
  ] as const)("rejects validly signed %s violation", async (_kind, mutate, reason) => {
    const f = await fixture(mutate);
    await expect(readStagedSnapshotArtifacts(f.input)).rejects.toThrow(`SNAPSHOT_ARTIFACT_${reason}`);
    for (const call of f.forbidden) expect(call).not.toHaveBeenCalled();
  });
  it("rejects foreign binding or conflicting digest before any IO", async () => {
    const f = await fixture(); f.input.projectId = "foreign-project";
    await expect(readStagedSnapshotArtifacts(f.input)).rejects.toThrow("SNAPSHOT_PUBLICATION_BINDING_CONFLICT");
    expect(f.send).not.toHaveBeenCalled(); f.input.projectId = f.binding.projectId;
    f.binding.manifestSha256 = "f".repeat(64);
    await expect(readStagedSnapshotArtifacts(f.input)).rejects.toThrow("SNAPSHOT_PUBLICATION_BINDING_CONFLICT");
    expect(f.send).not.toHaveBeenCalled();
  });
  it("fails on missing manifest and on a missing selected dataset", async () => {
    const f = await fixture(); f.objects.delete(f.manifestKey);
    await expect(readStagedSnapshotArtifacts(f.input)).rejects.toThrow("SNAPSHOT_ARTIFACT_MANIFEST_MISSING");
    const g = await fixture(); g.objects.delete(createProjectSnapshotKey(g.binding.projectId, g.manifest.files[0]!.sha256));
    await expect(readStagedSnapshotArtifacts(g.input)).rejects.toThrow("SNAPSHOT_ARTIFACT_FILE_MISSING");
    expect(g.keys).toHaveLength(2);
  });
  it("fails on corrupt bytes and destroys the actual S3 reader", async () => {
    const f = await fixture(); const key = createProjectSnapshotKey(f.binding.projectId, f.manifest.files[0]!.sha256);
    const bytes = Uint8Array.from(f.objects.get(key)!); bytes[0] = bytes[0]! ^ 1; f.objects.set(key, bytes);
    await expect(readStagedSnapshotArtifacts(f.input)).rejects.toThrow("OBJECT_STORAGE_READ_HASH_MISMATCH");
    expect(f.destroyed).toHaveBeenCalledTimes(2);
  });
  it.each([
    ["invalid gzip", Uint8Array.of(1, 2, 3), "FILE_GZIP_INVALID"],
    ["signed gzip bomb", gzipSync(Buffer.alloc(16 * 1024 * 1024 + 1, 32)), "SNAPSHOT_LIMIT_EXCEEDED"],
  ] as const)("rejects %s after authenticating its compressed bytes", async (_kind, body, reason) => {
    const f = await fixture(undefined, undefined, (composition) => { composition.files[0]!.body = body; });
    await expect(readStagedSnapshotArtifacts(f.input)).rejects.toThrow(`SNAPSHOT_ARTIFACT_${reason}`);
    expect(f.destroyed).toHaveBeenCalledTimes(14);
  });
  it("rejects declared record cardinality different from actual decoded count", async () => {
    const f = await fixture(undefined, (manifest) => { manifest.files[0]!.count += 1; });
    await expect(readStagedSnapshotArtifacts(f.input)).rejects.toThrow("SNAPSHOT_ARTIFACT_DATASET_SCHEMA_INVALID");
  });
  it("rejects an invalid signature even when binding hash and stored manifest agree", async () => {
    const f = await fixture(); f.manifest.signature = Buffer.alloc(64).toString("base64url");
    const bytes = canonicalJsonBytes(f.manifest as CanonicalJsonValue);
    f.binding.manifestCanonical = Buffer.from(bytes).toString("utf8"); f.binding.manifestSha256 = calculateObjectSha256(bytes);
    const key = createProjectSnapshotKey(f.binding.projectId, f.binding.manifestSha256); f.objects.set(key, bytes);
    await expect(readStagedSnapshotArtifacts(f.input)).rejects.toThrow("SNAPSHOT_ARTIFACT_INVALID_SIGNATURE");
    expect(f.keys).toEqual([key]);
  });
  it("rejects noncanonical binding bytes, foreign last-good or mismatched binding key identity", async () => {
    const f = await fixture(); f.binding.manifestCanonical = JSON.stringify(f.manifest, null, 2);
    const bytes = new TextEncoder().encode(f.binding.manifestCanonical); f.binding.manifestSha256 = calculateObjectSha256(bytes);
    f.objects.set(createProjectSnapshotKey(f.binding.projectId, f.binding.manifestSha256), bytes);
    await expect(readStagedSnapshotArtifacts(f.input)).rejects.toThrow("SNAPSHOT_PUBLICATION_BINDING_CONFLICT");
    expect(f.keys).toHaveLength(1);
    const g = await fixture(); g.input.lastGood.projectId = "foreign-project";
    await expect(readStagedSnapshotArtifacts(g.input)).rejects.toThrow("SNAPSHOT_PUBLICATION_BINDING_CONFLICT");
    expect(g.send).not.toHaveBeenCalled();
    const h = await fixture(); h.binding.keyId = "different-key";
    await expect(readStagedSnapshotArtifacts(h.input)).rejects.toThrow("SNAPSHOT_PUBLICATION_BINDING_CONFLICT");
    expect(h.keys).toEqual([h.manifestKey]);
  });
  it("aborts before IO and after manifest IO without reading any dataset", async () => {
    const f = await fixture(); const controller = new AbortController(); controller.abort();
    await expect(readStagedSnapshotArtifacts({ ...f.input, signal: controller.signal })).rejects.toThrow("SNAPSHOT_PUBLICATION_CANCELLED");
    expect(f.send).not.toHaveBeenCalled();
    const g = await fixture(); const late = new AbortController();
    const original = g.input.storage.getBounded.bind(g.input.storage);
    vi.spyOn(g.input.storage, "getBounded").mockImplementation(async (request) => { const result = await original(request); late.abort(); return result; });
    await expect(readStagedSnapshotArtifacts({ ...g.input, signal: late.signal })).rejects.toThrow("SNAPSHOT_PUBLICATION_CANCELLED");
    expect(g.keys).toEqual([g.manifestKey]); expect(g.destroyed).toHaveBeenCalledOnce();
  });
});
