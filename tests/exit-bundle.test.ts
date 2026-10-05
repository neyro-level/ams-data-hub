import { createHash } from "node:crypto";
import { agentPublicV1Schema, PROJECT_EXIT_DATASET_KINDS, projectExitBundleV1Schema, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { describe, expect, it, vi } from "vitest";
import { createProjectExitBundle, createProtectedConsentEvidenceExport, validateProjectExitBundle } from "../src/modules/operations-control/index.ts";

const generatedAt = "2026-10-05T12:00:00.000Z";
const mediaBody = new TextEncoder().encode("synthetic-media");
const mediaSha = createHash("sha256").update(mediaBody).digest("hex");
const contractBody = new TextEncoder().encode('{"$schema":"https://json-schema.org/draft/2020-12/schema"}');
const publicAgent = agentPublicV1Schema.parse({
  schemaMajor: 1,
  schemaMinor: 0,
  uid: "01J00000000000000000000000",
  slug: "anna-agent",
  role: "AGENT",
  fullName: "Анна Агент",
  position: "Эксперт",
  bio: null,
  specializations: ["Квартиры"],
  photoUrl: "https://client.example/media/anna.webp",
  workPhone: "+79990000000",
  workEmail: "anna@example.test",
  messengers: ["https://t.me/anna"],
  sortOrder: 10,
});

function datasets(agent: CanonicalJsonValue = publicAgent) {
  return PROJECT_EXIT_DATASET_KINDS.map((kind) => ({ kind, records: kind === "agents" ? [agent] : [] }));
}

describe("ProjectExitBundleV1 composer", () => {
  const admin = { kind: "platform-admin", userId: "admin-1", correlationId: "exit-correlation-1" } as const;
  const audit = { record: vi.fn(async () => undefined) };

  it("builds and validates a public local-mode handoff with rewritten media URLs", async () => {
    const copy = vi.fn(async () => undefined);
    const composition = await createProjectExitBundle(admin, {
      projectId: "project-1",
      generatedAt,
      datasets: datasets(),
      media: [{ sourceStorageKey: `media/${mediaSha}`, targetPath: "media/anna.webp", targetUrl: "https://client.example/media/anna.webp", sha256: mediaSha, bytes: mediaBody.byteLength, contentType: "image/webp" }],
      vendoredContracts: [{ path: "contracts/snapshot-v1.schema.json", body: contractBody }],
      mediaTransfer: { copy },
    }, { audit });

    expect(projectExitBundleV1Schema.parse(composition.manifest)).toMatchObject({ dataMode: "local", publicOnly: true, protectedConsentEvidenceIncluded: false });
    expect(validateProjectExitBundle(composition)).toEqual(composition.manifest);
    expect(copy).toHaveBeenCalledWith(expect.objectContaining({ sourceStorageKey: `media/${mediaSha}`, targetPath: "media/anna.webp" }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project-1", actorId: "admin-1" }));
    const serialized = JSON.stringify(composition.manifest) + composition.files.map((file) => new TextDecoder().decode(file.body)).join("");
    expect(serialized).toContain("https://client.example/media/anna.webp");
    expect(serialized).not.toContain(`media/${mediaSha}`);
    expect(serialized).not.toContain("consentConfirmedBy");
  });

  it("rejects private consent fields before media transfer", async () => {
    const copy = vi.fn(async () => undefined);
    await expect(createProjectExitBundle(admin, {
      projectId: "project-1",
      generatedAt,
      datasets: datasets({ ...publicAgent, consentConfirmedBy: "private operator" }),
      media: [],
      vendoredContracts: [{ path: "contracts/snapshot-v1.schema.json", body: contractBody }],
      mediaTransfer: { copy },
    }, { audit })).rejects.toThrow("SNAPSHOT_PRIVACY_FORBIDDEN_FIELD");
    expect(copy).not.toHaveBeenCalled();
  });

  it("fails validation when an artifact body no longer matches its digest", async () => {
    const composition = await createProjectExitBundle(admin, {
      projectId: "project-1",
      generatedAt,
      datasets: datasets(),
      media: [],
      vendoredContracts: [{ path: "contracts/snapshot-v1.schema.json", body: contractBody }],
      mediaTransfer: { copy: async () => undefined },
    }, { audit });
    const firstDataset = composition.files.find((file) => file.path.startsWith("data/"))!;
    const corrupted = { ...composition, files: composition.files.map((file) => file === firstDataset ? { ...file, body: new TextEncoder().encode("[] ") } : file) };
    expect(() => validateProjectExitBundle(corrupted)).toThrow("EXIT_BUNDLE_ARTIFACT_MISMATCH");
  });

  it("denies a tenant before reading or transferring export data", async () => {
    const copy = vi.fn(async () => undefined);
    await expect(createProjectExitBundle({ kind: "tenant-user", userId: "user-1", organizationId: "org-1", membershipId: "member-1", role: "ORG_ADMIN", projectIds: "*", correlationId: "corr-tenant" }, {
      projectId: "project-1",
      generatedAt,
      datasets: datasets(),
      media: [],
      vendoredContracts: [{ path: "contracts/snapshot-v1.schema.json", body: contractBody }],
      mediaTransfer: { copy },
    }, { audit })).rejects.toThrow("OPERATIONS_CONTROL_ADMIN_ACCESS_DENIED");
    expect(copy).not.toHaveBeenCalled();
  });

  it("keeps protected consent evidence in a separate audited transfer", async () => {
    const transfer = { write: vi.fn(async () => ({ receiptId: "protected-receipt-1" })) };
    const consentAudit = { record: vi.fn(async () => undefined) };
    const result = await createProtectedConsentEvidenceExport(admin, {
      projectId: "project-1",
      generatedAt,
      legalBasisReference: "owner-approved-handoff-1",
      entries: [{ agentUid: publicAgent.uid, confirmedBy: "Synthetic Operator", confirmedAt: generatedAt, basis: "Synthetic consent basis", referenceUrl: null, note: null }],
    }, { transfer, audit: consentAudit });
    expect(result).toMatchObject({ entryCount: 1, receiptId: "protected-receipt-1" });
    expect(result).not.toHaveProperty("body");
    expect(transfer.write).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project-1", body: expect.any(Uint8Array) }));
    expect(consentAudit.record).toHaveBeenCalledWith(expect.objectContaining({ actorId: "admin-1", receiptId: "protected-receipt-1" }));
  });
});
