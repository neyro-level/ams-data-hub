import { randomUUID } from "node:crypto";
import { S3Client } from "@aws-sdk/client-s3";
import { expect, it, vi } from "vitest";

const cuts = vi.hoisted(() => ({ worker: 0 }));
vi.mock("../../src/platform/database/transaction.ts", async (original) => {
  const actual = await original<typeof import("../../src/platform/database/transaction.ts")>();
  const authorized: typeof actual.runInAuthorizedDatabaseTransaction = (context, execute, options) =>
    actual.runInAuthorizedDatabaseTransaction(context, async (tx) => {
      if (context.principalKind === "project-job") {
        await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
        expect(await tx.$queryRawUnsafe("SELECT rolbypassrls,rolsuper FROM pg_roles WHERE rolname=current_user"))
          .toEqual([{ rolbypassrls: false, rolsuper: false }]); cuts.worker++;
      }
      return execute(tx);
    }, options);
  const principal: typeof actual.runInPrincipalDatabaseTransaction = (context, execute) =>
    authorized(actual.createDatabaseAuthorizationContext(context), execute);
  return { ...actual, runInAuthorizedDatabaseTransaction: authorized, runInPrincipalDatabaseTransaction: principal };
});
import { runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";
import type { PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";
import { createProjectJobPrincipal } from "../../src/platform/authorization/principal-factories.ts";
import { createProjectObjectStorageResolver } from "../../src/platform/storage/project-object-storage.ts";
import { sourceRegistryCommands } from "../../src/modules/ingestion-core/server.ts";
import { newbuildingImportCommands, sharedCatalogCommands, catalogSubscriptionCommands } from "../../src/modules/shared-catalog/server.ts";
import { projectUrlRegistryCommands } from "../../src/modules/project-state/server.ts";
import { captureSnapshotInput, createSnapshotCandidateAssemblyServer } from "../../src/modules/snapshot-delivery/server.ts";

it("projects a reviewed manual newbuilding import through catalog revision into a real snapshot without fabricated business facts", async () => {
  const suffix = randomUUID().slice(0, 8);
  const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-newbuilding", correlationId: randomUUID() };
  const scope = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
    const organization = await tx.organization.create({ data: { name: "Synthetic newbuilding", slug: `nb-proof-${suffix}` } });
    const project = await tx.project.create({ data: { organizationId: organization.id, name: "Synthetic newbuilding", slug: `nb-proof-${suffix}` } });
    await tx.dataSafetyState.upsert({ where: { id: "global" }, create: { id: "global", jobsFrozen: false, unfrozenAt: new Date() },
      update: { jobsFrozen: false, unfrozenAt: new Date() } });
    return { organizationId: organization.id, projectId: project.id };
  });
  // A real registered disabled Source owns the manual import, not a fake GOOD revision.
  const source = await sourceRegistryCommands.createSource(admin, { ...scope, sourceKey: "synthetic-manual-newbuilding",
    name: "Synthetic manual newbuilding", endpointCredentialRef: `SYNTHETIC_NEWBUILDING_${suffix.toUpperCase()}`,
    adapterKey: "yrl-realty-2010", adapterVersion: "1.0.0", profileKey: "default-v1", profileVersion: "1.0.0",
    datasetType: "NEW_BUILD", transportType: "HTTPS_XML", sharingPolicy: "PROJECT_ONLY",
    schedulePolicy: { mode: "MANUAL_ONLY" }, safetyPolicyId: "", expectedNamespace: "", expectedProducer: "" });
  const developer = await sharedCatalogCommands.createDeveloper(admin, { name: `Synthetic developer ${suffix}`, lifecycle: "ACTIVE", aliases: [] });
  const input = { ...scope, payload: {
    source: { sourceId: source.sourceId, externalId: "synthetic-development", observedAt: "2026-10-08T00:00:00.000Z" },
    target: { developmentUid: null, developerUid: developer.uid, cityUid: "01M41T6Q04BADHXSERJHZFXKCH", districtUid: null },
    development: { name: `Synthetic development ${suffix}`, addressLine: "ул. Макетная", latitude: 47.2, longitude: 39.7 },
    prices: [{ externalId: "synthetic-lot", amount: 1000000, currency: "RUB", basis: "TOTAL" as const, areaM2: 40, roomCount: 1 }],
    media: [],
  } };
  const state = () => runInPrincipalDatabaseTransaction(admin, async (tx) => ({
    developments: await tx.development.findMany({ where: { name: input.payload.development.name } }),
    identities: await tx.developmentExternalIdentity.findMany({ where: { ...scope, sourceId: source.sourceId } }),
    prices: await tx.priceObservation.findMany({ where: { ...scope, sourceId: source.sourceId } }),
    revisions: await tx.catalogChangeSet.findMany({ where: { correlationId: admin.correlationId, action: "newbuilding.manual-import" } }),
    audits: await tx.auditEvent.findMany({ where: { organizationId: scope.organizationId, correlationId: admin.correlationId, action: "newbuilding.manual-import" } }),
  }));
  const before = await state();
  const preview = await newbuildingImportCommands.preview(admin, input);
  expect(preview.plan).toMatchObject({ mode: "DRY_RUN", requiresExplicitConfirmation: true, developmentUid: null });
  expect(preview.plan.developmentChanges.map((change) => change.field)).toEqual(["name", "addressLine", "latitude", "longitude"]);
  expect(preview.plan.newPriceKeys).toHaveLength(1); expect(preview.planSha256).toMatch(/^[a-f0-9]{64}$/u);
  expect(await state()).toEqual(before);
  await expect(newbuildingImportCommands.apply(admin, { ...input, confirmed: false as unknown as true,
    reviewedPlanSha256: preview.planSha256 })).rejects.toThrow();
  await expect(newbuildingImportCommands.apply(admin, { ...input, confirmed: true, reviewedPlanSha256: "0".repeat(64) }))
    .rejects.toThrow("NEWBUILDING_REVIEW_STALE");
  expect(await state()).toEqual(before);
  const applied = await newbuildingImportCommands.apply(admin, { ...input, confirmed: true, reviewedPlanSha256: preview.planSha256 });
  expect(applied.version).toBe(1);
  const persisted = await state();
  expect(persisted.developments).toHaveLength(1); expect(persisted.identities).toHaveLength(1); expect(persisted.prices).toHaveLength(1);
  expect(persisted.revisions).toHaveLength(1); expect(persisted.audits).toHaveLength(1);
  expect(persisted.identities[0]).toMatchObject({ developmentUid: applied.uid, externalId: "synthetic-development" });
  const revision = await runInPrincipalDatabaseTransaction(admin, (tx) => tx.catalogEntityVersion.findUniqueOrThrow({
    where: { entityType_entityUid_version: { entityType: "DEVELOPMENT", entityUid: applied.uid, version: 1 } },
  }));
  expect(revision.changeSetId).toBe(persisted.revisions[0]!.id);
  expect(revision.snapshot).toMatchObject({ uid: applied.uid, version: 1, name: input.payload.development.name });
  await expect(newbuildingImportCommands.apply(admin, { ...input, confirmed: true, reviewedPlanSha256: preview.planSha256 }))
    .rejects.toThrow("NEWBUILDING_REVIEW_STALE");
  expect(await state()).toEqual(persisted);
  await catalogSubscriptionCommands.replaceProjectSubscription(admin, { ...scope, version: 0, mode: "CURATED", cityUids: [],
    selections: [{ developmentUid: applied.uid, decision: "INCLUDE" }] });
  await projectUrlRegistryCommands.replaceProjectUrlPolicy(admin, { ...scope, version: 0, policyKey: "synthetic-newbuilding",
    pathTemplates: [{ entityType: "DEVELOPMENT", template: "/developments/{slug}" }, { entityType: "DEVELOPER", template: "/developers/{slug}" }], reservedNamespaces: [] });
  for (const entity of [{ entityType: "DEVELOPMENT" as const, uid: applied.uid, path: "developments" },
    { entityType: "DEVELOPER" as const, uid: developer.uid, path: "developers" }]) {
    const entry = await projectUrlRegistryCommands.createProjectUrlEntry(admin, { ...scope, entityType: entity.entityType,
      entityUid: entity.uid, slug: "synthetic", canonicalPath: `/${entity.path}/synthetic` });
    await projectUrlRegistryCommands.publishProjectUrlEntry(admin, { ...scope, urlEntryId: entry.urlEntryId, version: entry.version });
  }
  vi.stubEnv("PROJECT_STORAGE_BINDINGS", JSON.stringify([{ ...scope, bucketRef: "SYNTHETIC_NEWBUILDING_BUCKET",
    endpointRef: "SYNTHETIC_NEWBUILDING_ENDPOINT", regionRef: "SYNTHETIC_NEWBUILDING_REGION",
    accessKeyIdRef: "SYNTHETIC_NEWBUILDING_ACCESS", secretAccessKeyRef: "SYNTHETIC_NEWBUILDING_SECRET" }]));
  vi.stubEnv("SYNTHETIC_NEWBUILDING_BUCKET", `synthetic-newbuilding-${suffix}`);
  vi.stubEnv("SYNTHETIC_NEWBUILDING_ENDPOINT", "https://s3.twcstorage.ru");
  vi.stubEnv("SYNTHETIC_NEWBUILDING_REGION", "ru-1");
  vi.stubEnv("SYNTHETIC_NEWBUILDING_ACCESS", "synthetic-access"); vi.stubEnv("SYNTHETIC_NEWBUILDING_SECRET", "synthetic-secret");
  const sdk = vi.spyOn(S3Client.prototype, "send").mockRejectedValue(new Error("SYNTHETIC_UNEXPECTED_OBJECT_IO"));
  try {
    const storage = createProjectObjectStorageResolver()(scope);
    const job = createProjectJobPrincipal({ ...scope, jobName: "snapshot-input" });
    const captured = await captureSnapshotInput(job, { ...scope, schemaMinor: 0, idempotencyKey: randomUUID() });
    expect(captured.catalogRevision).toMatch(/^[a-f0-9]{64}$/u);
    const snapshot = await createSnapshotCandidateAssemblyServer({ ...scope, storage })(job,
      { idempotencyKeyHash: captured.idempotencyKeyHash, requestHash: captured.requestHash });
    expect(snapshot.manifestMetadata.catalogRevision).toBe(captured.catalogRevision);
    const developments = snapshot.datasets.find((dataset) => dataset.kind === "developments")!.records;
    expect(developments).toHaveLength(1);
    expect(developments[0]!.value).toMatchObject({ uid: applied.uid, name: input.payload.development.name, latitude: "47.2", longitude: "39.7" });
    expect(snapshot.datasets.find((dataset) => dataset.kind === "prices")!.records)
      .toContainEqual(expect.objectContaining({ value: expect.objectContaining({ developmentUid: applied.uid, amount: "1000000", currency: "RUB" }) }));
    expect(JSON.stringify(snapshot.datasets)).not.toMatch(/sourceId|reviewedPlanSha256|sourceUrl|endpointCredentialRef/u);
    expect(sdk).not.toHaveBeenCalled(); expect(cuts.worker).toBeGreaterThan(0);
  } finally { sdk.mockRestore(); vi.unstubAllEnvs(); }
}, 60_000);
