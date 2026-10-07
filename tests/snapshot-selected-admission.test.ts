import { createUlid, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { joyworkYandexRealtyProfile } from "../src/modules/ingestion-core/index.ts";
import { SNAPSHOT_INPUT_PART_KINDS, SnapshotInputPartsBuilder, snapshotBuildInputDigest, snapshotInputHash,
  type SnapshotBuildInputReceipt, type SnapshotInputPartKind } from "../src/modules/snapshot-delivery/application/snapshot-build-input.ts";
import { prepareSnapshotInventoryInput } from "../src/modules/snapshot-delivery/application/snapshot-inventory-input.ts";
import { projectSnapshotInventory } from "../src/modules/snapshot-delivery/application/snapshot-inventory-projector.ts";
import { projectSnapshotCatalog } from "../src/modules/snapshot-delivery/application/snapshot-catalog-projector.ts";
import { selectSnapshotCatalog } from "../src/modules/snapshot-delivery/application/snapshot-catalog-selection.ts";
import { projectSnapshotProjectState } from "../src/modules/snapshot-delivery/application/snapshot-project-state-projector.ts";
import { composeSnapshot } from "../src/modules/snapshot-delivery/application/snapshot-composer.ts";
import { signSnapshotManifest } from "../src/modules/snapshot-delivery/application/snapshot-signing.ts";
import { verifySnapshotPublicArtifacts } from "../src/modules/snapshot-delivery/application/snapshot-public-verification.ts";
import { prepareSelectedSnapshotAdmission } from "../src/modules/snapshot-delivery/application/snapshot-selected-admission.ts";
import { projectSnapshotMedia } from "../src/modules/snapshot-delivery/application/snapshot-media-projector.ts";

const time = "2026-10-07T00:00:00.000Z";
async function fixture(boundAgent = true, withMedia = false) {
  const [uid, agent, region, city, developer, development, building, former] = Array.from({ length: 8 }, () => createUlid()) as string[];
  const profile = joyworkYandexRealtyProfile; const identity = `${profile.key}@${profile.version}`;
  const approval = (revisionId: string, sequence: number) => ({ version: 1, disposition: "SAFE", sourceId: "source", revisionId, sequence,
    policyHash: "c".repeat(64), analysisHash: "d".repeat(64), baseRevisionId: sequence === 1 ? null : "good-old",
    previousGoodRecordCount: sequence === 1 ? null : 1 });
  const pin = { uid: uid!, sourceId: "source", externalOfferId: "synthetic", status: "ACTIVE", normalizedHash: "b".repeat(64),
    sourceHash: "a".repeat(64), factProfileIdentity: identity, factProfileKey: profile.key, factProfileVersion: profile.version,
    factRevisionId: "good-old", factRevisionSequence: 1, approvedHeadId: "good-head", approvedHeadSequence: 2,
    factApproval: approval("good-old", 1), firstSeenAt: time, lastSeenAt: time, createdAt: time, updatedAt: time,
    sourceCreatedAt: null, sourceUpdatedAt: null };
  const base = { name: "Synthetic", normalizedName: "synthetic", lifecycle: "ACTIVE", mergedIntoUid: null, aliases: [], version: 1 };
  const price = { sourceId: "source", externalId: "private", developmentUid: development!, buildingUid: building!,
    amount: "9000000.99", currency: "RUB", observedAt: time, basis: "TOTAL", areaM2: "40.01", roomCount: 0 };
  const facts: Partial<Record<SnapshotInputPartKind, CanonicalJsonValue[]>> = {
    project: [{ id: "project", status: "ACTIVE", serviceState: "ACTIVE" }],
    subscription: [{ mode: "CURATED", version: 1, cityUids: [city!], selections: [{ developmentUid: development!, decision: "INCLUDE" }] }],
    sources: [{ entityType: "profile", identity, configuration: null, formatContract: profile.formatContract! as unknown as CanonicalJsonValue },
      { entityType: "source", sourceId: "source", datasetType: "RESALE", sharingPolicy: "PROJECT_ONLY", enabled: false,
        approvedHead: { id: "good-head", sequence: 2, status: "GOOD", normalizedContentHash: "e".repeat(64), approval: approval("good-head", 2) } }],
    inventory: [pin], catalog: [
      { ...base, entityType: "region", uid: region!, code: "RU-MOW" }, { ...base, entityType: "city", uid: city!, regionUid: region! },
      { ...base, entityType: "developer", uid: developer! },
      { ...base, entityType: "development", uid: development!, developerUid: developer!, cityUid: city!, districtUid: null,
        addressLine: null, latitude: null, longitude: null },
      { ...base, entityType: "building", uid: building!, developmentUid: development!, label: "One", floors: 10,
        commissioningYear: 2027, commissioningQuarter: 2, constructionStatus: "UNDER_CONSTRUCTION", material: null, housingClass: null }],
    prices: [{ ...price, id: "private-price-a" }, { ...price, id: "private-price-b" }],
    agents: [{ uid: agent!, version: 1, slug: "agent", role: "AGENT", fullName: "Synthetic Agent", position: null, bio: null,
      specializations: [], workPhone: null, workEmail: null, messengers: [], sortOrder: 0, status: "ACTIVE", showOnSite: true,
      consentConfirmedAt: time, photoMediaId: null, feedPhotoMediaId: null }],
    contacts: [{ version: 1, phone: "+70000000002", email: null, addressPublic: null, messengers: [], hours: null }],
    "listing-links": boundAgent ? [{ entityType: "agent-binding", inventoryUid: uid!, sourceId: "source", sourceRevisionId: "good-old",
      recordHash: pin.normalizedHash, agentUid: agent! }] : [],
    urls: [{ factType: "reservation", id: "reservation", subjectType: "INVENTORY", subjectUid: former!, publicUrlId: "1234567890123456" },
      { factType: "entry", id: "entry", entityType: "INVENTORY", entityUid: uid!, slug: "offer", canonicalPath: "/offers/offer",
        factualLifecycle: "ACTIVE", presentationLifecycle: "VISIBLE", redirectTargetPath: null, publishedAt: time, retiredAt: null,
        reservation: { publicUrlId: "1234567890123456" } }],
    lifecycle: ["private-event-a", "private-event-b"].map((id) => ({ id, inventoryUid: former!, type: "INACTIVATED", occurredAt: time })),
  };
  if (withMedia) {
    const capturedAgent = facts.agents![0] as Record<string, CanonicalJsonValue>;
    capturedAgent.photoMediaId = "manual-photo"; capturedAgent.feedPhotoMediaId = "feed-photo";
    facts.media = ["manual", "feed"].map((slot, index) => ({ kind: "AGENT_PHOTO", agentUid: agent!, agentVersion: 1,
      slot: index === 0 ? "photoMediaId" : "feedPhotoMediaId", provenance: "ASSIGNED_ASSET_ONLY",
      asset: { id: `${slot}-photo`, sha256: (index === 0 ? "f" : "a").repeat(64),
        storageKey: `media/${(index === 0 ? "f" : "a").repeat(64)}`, byteSize: 100,
        contentType: "image/jpeg", rightsBasis: "LICENSED", hasLicense: true } }));
  }
  const builder = new SnapshotInputPartsBuilder();
  for (const kind of SNAPSHOT_INPUT_PART_KINDS) builder.add(kind, facts[kind] ?? []);
  const parts = builder.finish();
  const receipt: SnapshotBuildInputReceipt = { id: "build", organizationId: "org", projectId: "project", idempotencyKeyHash: "a".repeat(64),
    requestHash: "b".repeat(64), inputSchemaVersion: 1, projectorVersion: "db-v1", schemaMinor: 0, publishSequence: 1,
    projectStateRevision: 1, capturedAt: new Date(time), parts, inputHash: "",
    catalogRevision: snapshotInputHash(parts.filter((part) => part.kind === "catalog").map(({ partIndex, payloadHash }) => ({ partIndex, payloadHash }))) };
  receipt.inputHash = snapshotBuildInputDigest(receipt);
  const captured = prepareSnapshotInventoryInput(receipt); const selected = selectSnapshotCatalog(receipt);
  const media = projectSnapshotMedia(withMedia ? [{ entityType: "AGENT", entityUid: agent!,
    media: { ref: "f".repeat(64), kind: "IMAGE", position: 0 } }] : []);
  const inventory = projectSnapshotInventory(receipt, captured.rows.map((row) => ({ ...row,
    fact: { inventoryUid: uid!, sourceId: "source", externalOfferId: "synthetic", normalizedHash: pin.normalizedHash, factProfileIdentity: identity,
      draft: { sourceFormat: "YRL_2010", propertyType: "APARTMENT", transactionType: "SALE", areaM2: 40 }, addressPublic: "Synthetic public street", fieldValues: {} },
    media: [], ...(boundAgent ? { agentUid: agent! } : {}) })));
  const composition = composeSnapshot({ projectId: receipt.projectId, schemaMinor: 0, publishSequence: 1, generatedAt: time, publishedAt: time,
    catalogRevision: receipt.catalogRevision, sourceRevisions: captured.sourceRevisions, keyId: "test-key", requiresProjectContact: !boundAgent,
    datasets: [...projectSnapshotCatalog(receipt, selected), ...projectSnapshotProjectState(receipt, media.agentMedia, selected), inventory, media.dataset] });
  const keys = generateKeyPairSync("ed25519");
  const manifest = await signSnapshotManifest(composition, { keyId: "test-key", async sign(bytes) { return Uint8Array.from(sign(null, bytes, keys.privateKey)); } });
  const verified = verifySnapshotPublicArtifacts({ manifest, files: Object.fromEntries(composition.files.map((file) => [file.manifest.key, file.body])),
    expectedProjectId: receipt.projectId, supportedSchemaMajor: 1, lastGood: null,
    trustSet: { currentKeyId: "test-key", nextKeyId: null, revokedKeyIds: [], publicKeys: { "test-key": keys.publicKey.export({ format: "pem", type: "spki" }).toString() } } });
  if (!verified.accepted) throw new Error(`FIXTURE_${verified.reason}`);
  return { receipt, verified, uid: uid!, agent: agent! };
}

describe("pure selected captured admission on authenticated nonempty artifacts", () => {
  it("does not admit a signed attachment from an ambiguous captured listing slot", async () => {
    const { receipt, verified, uid } = await fixture(true, true);
    const changed = structuredClone(receipt);
    const part = changed.parts.find((row) => row.kind === "media")!;
    for (const [index, digest] of ["f", "a"].entries()) part.payload.push({ kind: "LISTING_IMAGE", inventoryUid: uid,
      position: 0, sourceId: "source", recordHash: "b".repeat(64), approvedHeadId: "good-head", factRevisionId: "good-old",
      relationId: `relation-${index}`, relationRevisionId: "good-old", relationCanonicalUrlHash: "c".repeat(64),
      mirroredAt: time, mirrorStatus: "MIRRORED", asset: { id: `listing-${index}`, sha256: digest.repeat(64),
        storageKey: `media/${digest.repeat(64)}`, byteSize: 100, contentType: "image/jpeg", rightsBasis: "LICENSED", hasLicense: true } });
    const builder = new SnapshotInputPartsBuilder();
    for (const kind of SNAPSHOT_INPUT_PART_KINDS) builder.add(kind, changed.parts.filter((row) => row.kind === kind).flatMap((row) => row.payload));
    changed.parts = builder.finish(); changed.inputHash = snapshotBuildInputDigest(changed);
    const attachment = { entityType: "INVENTORY", entityUid: uid, media: { ref: "f".repeat(64), kind: "IMAGE", position: 0 } };
    expect(() => prepareSelectedSnapshotAdmission(changed, { ...verified,
      datasets: { ...verified.datasets, media: [...verified.datasets.media, attachment] } }))
      .toThrow("SNAPSHOT_SELECTED_ADMISSION_INVALID");
  });
  it("retains manual photo priority and rejects injected feed photo or foreign captured receipt", async () => {
    const { receipt, verified } = await fixture(true, true);
    expect(prepareSelectedSnapshotAdmission(receipt, verified).mediaAnchors.attachments[0]?.asset.id).toBe("manual-photo");
    const attachments = verified.datasets.media.map((raw) => {
      const row = raw as { entityType: string; entityUid: string; media: { ref: string; kind: string; position: number } };
      return { ...row, media: { ...row.media, ref: "a".repeat(64) } };
    });
    expect(() => prepareSelectedSnapshotAdmission(receipt, { ...verified, datasets: { ...verified.datasets, media: attachments } }))
      .toThrow("SNAPSHOT_PUBLICATION_MEDIA_ANCHORS_INVALID");
    const other = await fixture();
    expect(() => prepareSelectedSnapshotAdmission(other.receipt, verified)).toThrow("SNAPSHOT_SELECTED_ADMISSION_INVALID");
  });
  it.each([true, false])("preserves historical GOOD, producer OFF, relink and equal private-ID history; boundAgent=%s", async (bound) => {
    const { receipt, verified } = await fixture(bound); const before = structuredClone({ receipt, verified });
    const result = prepareSelectedSnapshotAdmission(receipt, verified);
    expect(result.sourceAnchors.inventory[0]?.factRevisionId).toBe("good-old");
    expect(result.requiresProjectContact).toBe(!bound);
    expect(result.catalogAnchors.developments).toHaveLength(1);
    expect(verified.datasets.prices).toHaveLength(2);
    expect(verified.datasets.lifecycle).toHaveLength(3);
    expect({ receipt, verified }).toEqual(before);
  });
  it.each(["missing", "extra", "url", "agent", "unbound-agent", "catalog", "contact", "price-count", "event-count"])("rejects attribution mismatch: %s", async (attack) => {
    const { receipt, verified } = await fixture(attack !== "unbound-agent");
    const data = structuredClone(verified.datasets) as unknown as { -readonly [K in keyof typeof verified.datasets]: Record<string, unknown>[] };
    if (attack === "missing") data.inventory = [];
    if (attack === "extra") data.inventory!.push({ ...data.inventory![0], uid: createUlid() });
    if (attack === "url") data.inventory![0]!.publicUrlId = "9999999999999999";
    if (attack === "agent") delete data.inventory![0]!.agentUid;
    if (attack === "unbound-agent") data.inventory![0]!.agentUid = createUlid();
    if (attack === "catalog") data.developments![0]!.uid = createUlid();
    if (attack === "contact") data["project/contacts"]![0]!.addressPublic = "Uncaptured office";
    if (attack === "price-count") data.prices!.pop();
    if (attack === "event-count") data.lifecycle!.pop();
    // Decoded-value unit attack, not an assertion of a still-valid signature.
    expect(() => prepareSelectedSnapshotAdmission(receipt, { ...verified, datasets: data }))
      .toThrow("SNAPSHOT_SELECTED_ADMISSION_INVALID");
  });
});
