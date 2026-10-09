import { canonicalJsonBytes, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { DEFAULT_SNAPSHOT_VERIFIER_LIMITS, SNAPSHOT_DATASET_KINDS, type SnapshotDatasetKind,
  type SnapshotManifestV1, type VerifySnapshotInput } from "@ams-data-hub/snapshot-verifier";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { vladisVt24Configuration } from "../src/modules/ingestion-core/index.ts";
import { projectSnapshotInventory } from "../src/modules/snapshot-delivery/application/snapshot-inventory-projector.ts";
import { verifySnapshotPublicArtifacts } from "../src/modules/snapshot-delivery/application/snapshot-public-verification.ts";

type Row = Record<string, CanonicalJsonValue>;
type Datasets = Record<SnapshotDatasetKind, Row[]>;
const uid = (suffix: string) => "01J9ZK8G7Q5X6NP3V4A2B1C0" + suffix;
const ids = { region: uid("DE"), city: uid("DF"), district: uid("DG"), developer: uid("DH"),
  development: uid("DJ"), building: uid("DK"), inventory: uid("DM"), agent: uid("DN"), missing: uid("DP") };
const publicUrlId = "01j9zk8g7q5x6np3";
const at = "2026-10-08T00:00:00.000Z";
const media = { ref: "a".repeat(64), kind: "IMAGE" as const, position: 0 };
const lastGood = Object.freeze({ projectId: "synthetic-public-policy", schemaMajor: 1, publishSequence: 1 });
// Ephemeral synthetic signing material, never an actual project credential.
const keys = generateKeyPairSync("ed25519");
const trustSet = { currentKeyId: "synthetic-policy-key", nextKeyId: null, revokedKeyIds: [] as string[],
  publicKeys: { "synthetic-policy-key": keys.publicKey.export({ format: "pem", type: "spki" }).toString() } };

function validDatasets(): Datasets {
  const profile = "vladis-vt24-v1@1.0.0";
  const inventory = projectSnapshotInventory({ organizationId: "synthetic-org", projectId: lastGood.projectId }, [{
    fact: { inventoryUid: ids.inventory, sourceId: "synthetic-source", externalOfferId: "synthetic-external",
      normalizedHash: "b".repeat(64), factProfileIdentity: profile,
      draft: { sourceFormat: "YRL_2010", propertyType: "APARTMENT", transactionType: "SALE", areaM2: 40,
        latitude: 55.75, longitude: 37.61, description: "<p>Synthetic <strong>safe</strong></p>" },
      addressPublic: "Synthetic City, street 1", fieldValues: {} },
    profile: { identity: profile, configuration: vladisVt24Configuration, formatContract: null },
    identity: { uid: ids.inventory, sourceId: "synthetic-source", externalOfferId: "synthetic-external",
      sourceHash: "c".repeat(64), normalizedHash: "b".repeat(64), factProfileIdentity: profile, status: "ACTIVE",
      firstSeenAt: at, lastSeenAt: at, sourceCreatedAt: null, sourceUpdatedAt: null, createdAt: at, updatedAt: at },
    url: { entityType: "INVENTORY", entityUid: ids.inventory, publicUrlId }, media: [media], agentUid: ids.agent,
  }]).records[0]!.value as Row;
  const geoBase = { lifecycle: "ACTIVE", aliases: [] };
  const subject = { entityType: "INVENTORY", entityUid: ids.inventory, publicUrlId };
  return {
    geo: [
      { ...geoBase, entityType: "region", uid: ids.region, name: "Synthetic region", normalizedName: "synthetic region", code: "RU-MOS" },
      { ...geoBase, entityType: "city", uid: ids.city, name: "Synthetic city", normalizedName: "synthetic city", regionUid: ids.region },
      { ...geoBase, entityType: "district", uid: ids.district, name: "Synthetic district", normalizedName: "synthetic district", cityUid: ids.city },
    ],
    developers: [{ uid: ids.developer, name: "Synthetic developer", lifecycle: "ACTIVE", aliases: [] }],
    developments: [{ uid: ids.development, name: "Synthetic development", developerUid: ids.developer,
      cityUid: ids.city, districtUid: ids.district, lifecycle: "ACTIVE", aliases: [],
      addressLine: "Synthetic street 1", latitude: "55.75", longitude: "37.61" }],
    buildings: [{ uid: ids.building, developmentUid: ids.development, label: "Synthetic building", floors: 5,
      commissioningYear: 2026, commissioningQuarter: 4, constructionStatus: "COMPLETED", material: null,
      housingClass: null, lifecycle: "ACTIVE", aliases: [] }],
    prices: [{ developmentUid: ids.development, buildingUid: ids.building, observedAt: at, amount: "1000",
      currency: "RUB", basis: "TOTAL", areaM2: "40", roomCount: 1 }],
    media: [{ entityType: "INVENTORY", entityUid: ids.inventory, media: { ...media } }],
    inventory: [inventory],
    agents: [{ uid: ids.agent, slug: "synthetic-agent", role: "AGENT", fullName: "Synthetic Agent", position: null,
      bio: null, specializations: [], workPhone: null, workEmail: null, messengers: [], sortOrder: 0, media: [] }],
    "project/contacts": [{ phone: "+70000000000", email: null, addressPublic: "Synthetic office", messengers: [], hours: null }],
    editorial: [{ entityType: "INVENTORY", entityUid: ids.inventory, shortDescription: "Synthetic text", description: null,
      faq: [], mediaOrder: [], isImageOrderChangeAllowed: false }],
    urls: [{ factType: "reservation", ...subject }, { factType: "entry", ...subject, slug: "synthetic-listing",
      canonicalPath: "/inventory/synthetic-listing", factualLifecycle: "ACTIVE", presentationLifecycle: "VISIBLE",
      redirectTargetPath: null, publishedAt: at, retiredAt: null }],
    redirects: [{ fromPath: "/inventory/previous", toPath: "/inventory/synthetic-listing", code: 301, reason: "SLUG_CHANGE", createdAt: at }],
    lifecycle: [{ factType: "inventory-state", inventoryUid: ids.inventory, status: "ACTIVE", effectiveAt: at }],
  };
}

function signedManifest(unsigned: Omit<SnapshotManifestV1, "signature">): SnapshotManifestV1 {
  return { ...unsigned, signature: sign(null, canonicalJsonBytes(unsigned as CanonicalJsonValue), keys.privateKey).toString("base64url") };
}
function fixture(datasets = validDatasets()): VerifySnapshotInput {
  const files: Record<string, Uint8Array> = {};
  const manifest = signedManifest({ schemaMajor: 1, schemaMinor: 0, projectId: lastGood.projectId, publishSequence: 2,
    generatedAt: at, publishedAt: at, catalogRevision: "synthetic-catalog", sourceRevisions: [], keyId: trustSet.currentKeyId,
    files: SNAPSHOT_DATASET_KINDS.map((kind) => {
      const body = gzipSync(canonicalJsonBytes(datasets[kind]));
      files[kind] = body;
      return { kind, key: kind, bytes: body.byteLength, sha256: createHash("sha256").update(body).digest("hex"), count: datasets[kind].length };
    }),
  });
  return { manifest, files, trustSet, expectedProjectId: lastGood.projectId, supportedSchemaMajor: 1, lastGood };
}
function patchManifest(input: VerifySnapshotInput, patch: Partial<Omit<SnapshotManifestV1, "signature">>): VerifySnapshotInput {
  const unsigned = Object.fromEntries(Object.entries(input.manifest as SnapshotManifestV1)
    .filter(([key]) => key !== "signature")) as Omit<SnapshotManifestV1, "signature">;
  return { ...input, manifest: signedManifest({ ...unsigned, ...patch }) };
}
function rejected(input: VerifySnapshotInput, reason: string) {
  const result = verifySnapshotPublicArtifacts(input);
  expect(result).toMatchObject({ accepted: false, reason });
  expect(result.nextState).toBe(lastGood);
  expect(lastGood.publishSequence).toBe(1);
}
function mutate(mutator: (datasets: Datasets) => void, reason = "DATASET_SCHEMA_INVALID") {
  const datasets = validDatasets();
  expect(verifySnapshotPublicArtifacts(fixture(datasets)).accepted).toBe(true);
  mutator(datasets);
  rejected(fixture(datasets), reason);
}

describe("project-owned strict thirteen-dataset public verifier", () => {
  it("accepts a populated signed public graph and the dedicated sanitized safe-HTML field", () => {
    const input = fixture();
    const result = verifySnapshotPublicArtifacts(input);
    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error(result.reason);
    expect(Object.keys(result.datasets).sort()).toEqual([...SNAPSHOT_DATASET_KINDS].sort());
    for (const kind of SNAPSHOT_DATASET_KINDS) expect(result.datasets[kind].length).toBeGreaterThan(0);
    expect(result.datasets.inventory[0]).toHaveProperty("descriptionHtmlSafe", "<p>Synthetic <strong>safe</strong></p>");
    expect(result.nextState.publishSequence).toBe(2);
    expect(JSON.stringify(result.datasets)).not.toMatch(/sourceHash|normalizedHash|externalOfferId|sourceId|fieldValues/u);
  });

  it.each(SNAPSHOT_DATASET_KINDS)("rejects signed private/raw provenance extra fields in %s, never stripping them", (kind) => {
    mutate((datasets) => { datasets[kind][0]!.rawImportIssuePayload = { sourceId: "private-sentinel", rawHtml: "<script>synthetic</script>" }; });
  });
  it.each(["id", "organizationId", "projectId", "sourceId", "externalId", "sourceHash", "normalizedHash", "sourceObjectCode"])(
    "rejects Prisma-shaped inventory leaking private %s", (field) => {
      mutate((datasets) => { datasets.inventory[0]![field] = "private-sentinel"; });
    },
  );
  it.each(["sourceUrl", "canonicalSourceUrl", "storageKey", "bucket", "credentialRef"])("rejects nested media provenance %s", (field) => {
    mutate((datasets) => { (datasets.media[0]!.media as Row)[field] = "private-sentinel"; });
    mutate((datasets) => { ((datasets.inventory[0]!.media as CanonicalJsonValue[])[0] as Row)[field] = "private-sentinel"; });
  });
  it("rejects a full raw-Prisma-shaped row passed directly into the public inventory dataset", () => {
    mutate((datasets) => { datasets.inventory[0] = { ...datasets.inventory[0]!, id: "synthetic-db-id",
      organizationId: "synthetic-org", projectId: lastGood.projectId, sourceId: "synthetic-source",
      externalId: "synthetic-external", sourceHash: "c".repeat(64), normalizedHash: "b".repeat(64),
      sourceObjectCode: "synthetic-private-code" }; });
  });
  it("rejects a private apartment number inside the otherwise valid public address", () => {
    mutate((datasets) => { (datasets.inventory[0]!.address as Row).apartmentNumberPrivate = "synthetic-private"; });
  });
  it.each(["consentConfirmedAt", "rawAgentMatchingEvidence", "privatePhone", "feedPhotoMediaId"])(
    "rejects private agent evidence %s", (field) => { mutate((datasets) => { datasets.agents[0]![field] = "private-sentinel"; }); },
  );
  it("rejects raw HTML in a schema-valid ordinary catalog name", () => {
    mutate((datasets) => { datasets.developers[0]!.name = "<strong>Synthetic</strong>"; });
  });
  it("rejects active attributes or non-approved tags in the safe-HTML exception", () => {
    for (const html of ["<p onclick='synthetic'>Text</p>", "<script>synthetic</script>"]) {
      mutate((datasets) => { datasets.inventory[0]!.descriptionHtmlSafe = html; });
    }
  });

  it.each([
    ["geo", "regionUid", 1], ["developments", "developerUid", 0], ["buildings", "developmentUid", 0],
    ["prices", "buildingUid", 0], ["inventory", "agentUid", 0], ["editorial", "entityUid", 0], ["media", "entityUid", 0],
  ] as const)("rejects schema-valid broken %s.%s reference", (kind, field, index) => {
    mutate((datasets) => { datasets[kind][index]![field] = ids.missing; }, "REFERENCE_INTEGRITY_INVALID");
  });
  it("rejects inventory URL association, missing reservations and unmatched embedded media", () => {
    mutate((datasets) => { datasets.urls[1]!.entityUid = ids.missing; }, "REFERENCE_INTEGRITY_INVALID");
    mutate((datasets) => { datasets.urls.shift(); }, "REFERENCE_INTEGRITY_INVALID");
    mutate((datasets) => { (datasets.media[0]!.media as Row).ref = "b".repeat(64); }, "REFERENCE_INTEGRITY_INVALID");
    mutate((datasets) => { datasets.media = []; }, "REFERENCE_INTEGRITY_INVALID");
  });
  it("rejects duplicate public identity rather than accepting a Map overwrite", () => {
    mutate((datasets) => { datasets.developers.push({ ...datasets.developers[0]! }); }, "REFERENCE_INTEGRITY_INVALID");
  });

  it.each(SNAPSHOT_DATASET_KINDS)("requires signed %s in the exact thirteen-dataset set", (kind) => {
    const input = fixture();
    const manifest = input.manifest as SnapshotManifestV1;
    rejected(patchManifest(input, { files: manifest.files.filter((file) => file.kind !== kind) }), "DATASET_SET_INVALID");
  });
  it("rejects duplicate dataset kinds and absent actual artifact bytes", () => {
    const input = fixture();
    const manifest = input.manifest as SnapshotManifestV1;
    const files = [...manifest.files]; files[1] = files[0]!;
    rejected(patchManifest(input, { files }), "DATASET_SET_INVALID");
    const absent = { ...input.files }; delete absent.geo;
    rejected({ ...input, files: absent }, "FILE_MISSING");
  });
  it("rejects tampered bytes, hashes, signed record counts and malformed gzip without replacing last-good", () => {
    const input = fixture();
    const manifest = input.manifest as SnapshotManifestV1;
    rejected({ ...input, files: { ...input.files, geo: input.files.geo!.slice(1) } }, "FILE_BYTES_MISMATCH");
    const corrupted = Uint8Array.from(input.files.geo!); corrupted[corrupted.length - 1] ^= 1;
    rejected({ ...input, files: { ...input.files, geo: corrupted } }, "FILE_HASH_MISMATCH");
    rejected(patchManifest(input, { files: manifest.files.map((file) => file.kind === "geo"
      ? { ...file, count: file.count + 1 } : file) }), "DATASET_SCHEMA_INVALID");
    const body = Uint8Array.from([1, 2, 3, 4]);
    const files = manifest.files.map((file) => file.kind === "geo" ? { ...file, bytes: body.byteLength,
      sha256: createHash("sha256").update(body).digest("hex") } : file);
    rejected(patchManifest({ ...input, files: { ...input.files, geo: body } }, { files }), "FILE_GZIP_INVALID");
  });
  it("rejects bad signature, revoked trust, foreign project, replay and rollback while retaining the exact last-good", () => {
    const input = fixture();
    rejected({ ...input, manifest: { ...input.manifest as SnapshotManifestV1, signature: "bad" } }, "INVALID_SIGNATURE");
    rejected({ ...input, trustSet: { ...trustSet, revokedKeyIds: [trustSet.currentKeyId] } }, "REVOKED_KEY_ID");
    rejected(patchManifest(input, { projectId: "foreign-synthetic-project" }), "PROJECT_MISMATCH");
    rejected(patchManifest(input, { publishSequence: 1 }), "STALE_PUBLISH_SEQUENCE");
    const accepted = verifySnapshotPublicArtifacts(input);
    expect(accepted.accepted).toBe(true);
    const replay = verifySnapshotPublicArtifacts({ ...input, lastGood: accepted.nextState });
    expect(replay).toMatchObject({ accepted: false, reason: "STALE_PUBLISH_SEQUENCE" });
    expect(replay.nextState).toBe(accepted.nextState);
  });
  it("rejects correctly signed gzip output exceeding the fixed production-policy limit", () => {
    const input = fixture();
    const body = gzipSync(JSON.stringify(["x".repeat(DEFAULT_SNAPSHOT_VERIFIER_LIMITS.maxDecompressedFileBytes)]));
    const manifest = input.manifest as SnapshotManifestV1;
    const files = manifest.files.map((file) => file.kind === "geo" ? { ...file, bytes: body.byteLength,
      sha256: createHash("sha256").update(body).digest("hex"), count: 1 } : file);
    rejected(patchManifest({ ...input, files: { ...input.files, geo: body } }, { files }), "SNAPSHOT_LIMIT_EXCEEDED");
  });
});
