import { randomUUID } from "node:crypto";
import { createUlid } from "@ams-data-hub/data-contracts";
import { describe, expect, it, vi } from "vitest";

const cuts = vi.hoisted(() => ({ commands: 0, capture: 0, beforeCapture: undefined as (() => Promise<void>) | undefined }));
// Command factories capture their runner at construction, not at test-spy time.
vi.mock("../../src/platform/database/transaction.ts", async (original) => {
  const actual = await original<typeof import("../../src/platform/database/transaction.ts")>();
  const principal: typeof actual.runInPrincipalDatabaseTransaction = (context, execute) =>
    actual.runInPrincipalDatabaseTransaction(context, async (tx) => {
      if (context.kind === "platform-admin" && context.userId === "synthetic-url-command-admin") {
        await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_web");
        expect(await tx.$queryRawUnsafe("SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user"))
          .toEqual([{ rolbypassrls: false, rolsuper: false }]); cuts.commands++;
      }
      return execute(tx);
    });
  const authorized: typeof actual.runInAuthorizedDatabaseTransaction = (context, execute, options) =>
    actual.runInAuthorizedDatabaseTransaction(context, async (tx) => {
      if (context.principalKind === "project-job" && context.actorId === "snapshot-input") {
        await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
        expect(await tx.$queryRawUnsafe("SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user"))
          .toEqual([{ rolbypassrls: false, rolsuper: false }]); cuts.capture++;
        if (options?.isolationLevel === "RepeatableRead") await cuts.beforeCapture?.();
      }
      return execute(tx);
    }, options);
  return { ...actual, runInPrincipalDatabaseTransaction: principal, runInAuthorizedDatabaseTransaction: authorized };
});
import { projectUrlRegistryCommands } from "../../src/modules/project-state/server.ts";
import { captureSnapshotInput, createSnapshotCandidateAssemblyServer } from "../../src/modules/snapshot-delivery/server.ts";
import { composeSnapshot } from "../../src/modules/snapshot-delivery/index.ts";
import { runInAuthorizedDatabaseTransaction, runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";
import { createProjectJobPrincipal } from "../../src/platform/authorization/principal-factories.ts";
import type { PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";

describe("persistent Hub URL commands through captured snapshot composition", () => {
  it("allocates distinct monotonic sequences to concurrent real captures, not to replays or failed captures", async () => {
    const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-sequence-fixture-admin", correlationId: randomUUID() };
    const scopes = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      const suffix = randomUUID().slice(0, 8);
      const organization = await tx.organization.create({ data: { name: "Synthetic sequence proof", slug: `sequence-${suffix}` } });
      const projects = await Promise.all(["a", "b"].map((key) => tx.project.create({ data: {
        organizationId: organization.id, name: "Synthetic sequence proof", slug: `sequence-${key}-${suffix}` } })));
      await tx.dataSafetyState.upsert({ where: { id: "global" }, create: { id: "global", jobsFrozen: false, unfrozenAt: new Date() },
        update: { jobsFrozen: false, unfrozenAt: new Date() } });
      return projects.map((project) => ({ organizationId: organization.id, projectId: project.id }));
    });
    const scope = scopes[0]!; const other = scopes[1]!;
    const job = createProjectJobPrincipal({ ...scope, jobName: "snapshot-input" });
    const request = (idempotencyKey: string) => ({ ...scope, idempotencyKey, schemaMinor: 0 });
    // This real command reserves before subscription capture fails; the entire
    // transaction must roll back, not merely hide an incomplete receipt.
    await expect(captureSnapshotInput(job, request("failed-before-subscription")))
      .rejects.toThrow("SHARED_CATALOG_SUBSCRIPTION_NOT_FOUND");
    await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      for (const target of scopes) await tx.projectCatalogSubscription.create({ data: { ...target, mode: "CURATED",
        cities: { create: { cityUid: "01M41T6Q04BADHXSERJHZFXKCH" } } } });
    });
    // Both real RR cuts exist before either enters the advisory-lock runner.
    // The losing first INSERT must retry the whole transaction, deterministically.
    let entrants = 0; let release!: () => void;
    const paired = new Promise<void>((resolve) => { release = resolve; });
    cuts.beforeCapture = async () => {
      if (++entrants <= 2) { if (entrants === 2) release(); await paired; }
    };
    const receipts = await (async () => {
      try { return await Promise.all(["distinct-a", "distinct-b"].map((key) => captureSnapshotInput(job, request(key)))); }
      finally { cuts.beforeCapture = undefined; }
    })();
    expect(entrants).toBeGreaterThanOrEqual(3);
    expect(receipts.map((row) => row.publishSequence).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(new Set(receipts.map((row) => row.id)).size).toBe(2);
    const replay = await Promise.all(receipts.map((row, index) => captureSnapshotInput(job, request(["distinct-a", "distinct-b"][index]!))));
    expect(replay).toEqual(receipts);
    const duplicates = await Promise.all([1, 2].map(() => captureSnapshotInput(job, request("same-key"))));
    expect(duplicates[0]).toEqual(duplicates[1]); expect(duplicates[0]!.publishSequence).toBe(3);
    const [next, independent] = await Promise.all([
      captureSnapshotInput(job, request("next-key")),
      captureSnapshotInput(createProjectJobPrincipal({ ...other, jobName: "snapshot-input" }),
        { ...other, idempotencyKey: "next-key", schemaMinor: 0 }),
    ]);
    expect(next.publishSequence).toBe(4); expect(independent.publishSequence).toBe(1);
    await runInAuthorizedDatabaseTransaction({ principalKind: "project-job", actorId: "snapshot-input",
      organizationId: scope.organizationId, projectIds: [scope.projectId], correlationId: randomUUID() }, async (tx) => {
      const rows = await tx.snapshotBuildInput.findMany({ orderBy: { publishSequence: "asc" }, select: { publishSequence: true } });
      expect(rows.map((row) => row.publishSequence)).toEqual([1, 2, 3, 4]);
      expect((await tx.projectSnapshotSequence.findFirstOrThrow()).lastReservedSequence).toBe(4);
      expect(await tx.snapshotBuildInput.count({ where: { projectId: other.projectId } })).toBe(0);
    });
    // A new failed request cannot consume the next sequence either.
    await runInPrincipalDatabaseTransaction(admin, (tx) => tx.projectCatalogSubscription.deleteMany({ where: scope }));
    await expect(captureSnapshotInput(job, request("failed-after-success")))
      .rejects.toThrow("SHARED_CATALOG_SUBSCRIPTION_NOT_FOUND");
    await runInPrincipalDatabaseTransaction(admin, (tx) => tx.projectCatalogSubscription.create({ data: { ...scope, mode: "CURATED",
      cities: { create: { cityUid: "01M41T6Q04BADHXSERJHZFXKCH" } } } }));
    expect((await captureSnapshotInput(job, request("after-rollback"))).publishSequence).toBe(5);
    await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      await tx.projectCurrentSnapshotManifest.create({ data: { ...scope, publishSequence: 7,
        manifestKey: "synthetic-sequence-floor", manifestSha256: "a".repeat(64), publishedAt: new Date() } });
      await tx.deliveryRun.create({ data: { ...scope, publishSequence: 11,
        manifestKey: "synthetic-delivery-floor", manifestSha256: "b".repeat(64), publishedAt: new Date() } });
    });
    expect((await captureSnapshotInput(job, request("above-delivery-floor"))).publishSequence).toBe(12);
    const databaseContext = { principalKind: "project-job" as const, actorId: "snapshot-input",
      organizationId: scope.organizationId, projectIds: [scope.projectId], correlationId: randomUUID() };
    await runInAuthorizedDatabaseTransaction(databaseContext, (tx) => tx.projectSnapshotSequence.update({
      where: { organizationId_projectId: scope }, data: { lastReservedSequence: 2_147_483_647 } }));
    await expect(captureSnapshotInput(job, request("exhausted"))).rejects.toThrow("SNAPSHOT_SEQUENCE_EXHAUSTED");
    await runInAuthorizedDatabaseTransaction(databaseContext, async (tx) => {
      expect((await tx.projectSnapshotSequence.findFirstOrThrow()).lastReservedSequence).toBe(2_147_483_647);
      expect(await tx.snapshotBuildInput.count()).toBe(6);
    });
  }, 60_000);

  it("preserves renamed/relinked IDs and redirect/GONE history without consumer SEO policy", async () => {
    cuts.commands = 0; cuts.capture = 0;
    const fixtureAdmin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-url-fixture-admin", correlationId: randomUUID() };
    const commandAdmin: PlatformAdminPrincipal = { ...fixtureAdmin, userId: "synthetic-url-command-admin" };
    const originalUid = createUlid(); const relinkedUid = createUlid(); const unusedUid = createUlid();
    const setup = await runInPrincipalDatabaseTransaction(fixtureAdmin, async (tx) => {
      const suffix = randomUUID().slice(0, 8);
      const organization = await tx.organization.create({ data: { name: "Synthetic URL proof", slug: `url-proof-${suffix}` } });
      const project = await tx.project.create({ data: { organizationId: organization.id, name: "Synthetic URL proof", slug: `url-proof-${suffix}` } });
      const foreign = await tx.project.create({ data: { organizationId: organization.id, name: "Synthetic foreign", slug: `url-proof-b-${suffix}` } });
      const scope = { organizationId: organization.id, projectId: project.id };
      await tx.dataSafetyState.upsert({ where: { id: "global" }, create: { id: "global", jobsFrozen: false, unfrozenAt: new Date() },
        update: { jobsFrozen: false, unfrozenAt: new Date() } });
      await tx.projectCatalogSubscription.create({ data: { ...scope, mode: "CURATED", cities: { create: { cityUid: "01M41T6Q04BADHXSERJHZFXKCH" } } } });
      await tx.publicUrlIdReservation.create({ data: { ...scope, subjectType: "INVENTORY", subjectUid: unusedUid, publicUrlId: "1234567890123456" } });
      return { scope, foreignId: foreign.id };
    });
    const scope = setup.scope;
    await projectUrlRegistryCommands.replaceProjectUrlPolicy(commandAdmin, { ...scope, version: 0, policyKey: "synthetic-route-policy",
      pathTemplates: [{ entityType: "INVENTORY", template: "/offers/{slug}" }], reservedNamespaces: ["admin", "api"] });
    const created = await projectUrlRegistryCommands.createProjectUrlEntry(commandAdmin, { ...scope,
      entityType: "INVENTORY", entityUid: originalUid, slug: "old", canonicalPath: "/offers/old" });
    const published = await projectUrlRegistryCommands.publishProjectUrlEntry(commandAdmin, { ...scope, urlEntryId: created.urlEntryId, version: created.version });
    const renamed = await projectUrlRegistryCommands.changeProjectUrlPath(commandAdmin, { ...scope,
      urlEntryId: published.urlEntryId, version: published.version, slug: "renamed", canonicalPath: "/offers/renamed" });
    const relinked = await projectUrlRegistryCommands.relinkProjectUrlEntry(commandAdmin, { ...scope,
      urlEntryId: renamed.urlEntryId, version: renamed.version, entityType: "INVENTORY", entityUid: relinkedUid });
    expect(relinked.publicUrlId).toBe(created.publicUrlId);
    const target = await projectUrlRegistryCommands.createProjectUrlEntry(commandAdmin, { ...scope,
      entityType: "INVENTORY", entityUid: createUlid(), slug: "target", canonicalPath: "/offers/target" });
    const job = createProjectJobPrincipal({ ...scope, jobName: "snapshot-input" });
    const head = vi.fn(); const assemble = createSnapshotCandidateAssemblyServer({ ...scope, storage: { head } });
    async function build(key: string) {
      const receipt = await captureSnapshotInput(job, { ...scope, idempotencyKey: key, schemaMinor: 0 });
      const lookup = { idempotencyKeyHash: receipt.idempotencyKeyHash, requestHash: receipt.requestHash };
      const candidate = await assemble(job, lookup);
      const composition = composeSnapshot({ schemaMinor: receipt.schemaMinor, projectId: receipt.projectId,
        publishSequence: receipt.publishSequence, generatedAt: receipt.capturedAt.toISOString(), publishedAt: receipt.capturedAt.toISOString(),
        catalogRevision: receipt.catalogRevision, sourceRevisions: [], keyId: "synthetic-unsigned-key",
        requiresProjectContact: candidate.requiresProjectContact, datasets: candidate.datasets });
      return { receipt, lookup, candidate, composition };
    }
    const before = await build("url-before-lifecycle");
    expect(before.candidate.requiresProjectContact).toBe(false);
    const urls = before.candidate.datasets.find((dataset) => dataset.kind === "urls")!.records;
    expect(urls).toContainEqual(expect.objectContaining({ key: `reservation:${created.publicUrlId}`,
      value: { factType: "reservation", entityType: "INVENTORY", entityUid: originalUid, publicUrlId: created.publicUrlId } }));
    expect(urls).toContainEqual(expect.objectContaining({ key: `entry:${created.publicUrlId}`,
      value: expect.objectContaining({ entityUid: relinkedUid, canonicalPath: renamed.canonicalPath, publishedAt: published.publishedAt!.toISOString() }),
      references: [{ kind: "urls", key: `reservation:${created.publicUrlId}` }] }));
    expect(urls).toContainEqual(expect.objectContaining({ key: "reservation:1234567890123456", value: expect.objectContaining({ entityUid: unusedUid }) }));
    expect(before.candidate.datasets.find((dataset) => dataset.kind === "redirects")!.records).toContainEqual(expect.objectContaining({
      value: expect.objectContaining({ fromPath: "/offers/old", toPath: "/offers/renamed", code: 301, reason: "SLUG_CHANGE" }) }));
    await expect(projectUrlRegistryCommands.transitionProjectUrlLifecycle(commandAdmin, { ...scope, urlEntryId: relinked.urlEntryId,
      version: relinked.version, factualLifecycle: "INACTIVE", presentationLifecycle: "REDIRECTED", redirectTargetPath: "/offers/missing", reason: "LIFECYCLE" }))
      .rejects.toThrow("PROJECT_URL_REDIRECT_TARGET_INVALID");
    await projectUrlRegistryCommands.transitionProjectUrlLifecycle(commandAdmin, { ...scope, urlEntryId: relinked.urlEntryId,
      version: relinked.version, factualLifecycle: "INACTIVE", presentationLifecycle: "REDIRECTED", redirectTargetPath: target.canonicalPath, reason: "LIFECYCLE" });
    const gone = await projectUrlRegistryCommands.transitionProjectUrlLifecycle(commandAdmin, { ...scope, urlEntryId: target.urlEntryId,
      version: target.version, factualLifecycle: "ARCHIVED", presentationLifecycle: "GONE", redirectTargetPath: null, reason: "RETIRE" });
    const after = await build("url-after-lifecycle");
    expect(after.receipt.inputHash).not.toBe(before.receipt.inputHash);
    expect(after.candidate.datasets.find((dataset) => dataset.kind === "urls")!.records).toContainEqual(expect.objectContaining({
      key: `entry:${created.publicUrlId}`, value: expect.objectContaining({ factualLifecycle: "INACTIVE", presentationLifecycle: "REDIRECTED", redirectTargetPath: target.canonicalPath }) }));
    expect(after.candidate.datasets.find((dataset) => dataset.kind === "urls")!.records).toContainEqual(expect.objectContaining({
      key: `entry:${target.publicUrlId}`, value: expect.objectContaining({ factualLifecycle: "ARCHIVED", presentationLifecycle: "GONE", retiredAt: gone.retiredAt!.toISOString() }) }));
    expect(after.candidate.datasets.find((dataset) => dataset.kind === "lifecycle")!.records).toContainEqual(expect.objectContaining({
      value: expect.objectContaining({ factType: "url-tombstone", publicUrlId: target.publicUrlId, canonicalPath: target.canonicalPath, reason: "RETIRE" }),
      references: [{ kind: "urls", key: `reservation:${target.publicUrlId}` }] }));
    expect(after.candidate.datasets.find((dataset) => dataset.kind === "redirects")!.records).toHaveLength(2);
    expect(await assemble(job, before.lookup)).toEqual(before.candidate);
    await expect(assemble(createProjectJobPrincipal({ ...scope, projectId: setup.foreignId, jobName: "snapshot-input" }), before.lookup))
      .rejects.toThrow("SNAPSHOT_INPUT_ACCESS_DENIED");
    const consumerOverride = { ...before.lookup, robots: "noindex", canonicalHost: "https://consumer.example.invalid" };
    await expect(assemble(job, consumerOverride)).rejects.toThrow();
    expect(JSON.stringify(after.candidate.datasets)).not.toMatch(/pathTemplates|reservedNamespaces|synthetic-route-policy|robots|indexability|sitemap|seoTitle|canonicalHost/u);
    expect(after.composition.files).toHaveLength(13); expect(head).not.toHaveBeenCalled();
    expect(cuts.commands).toBeGreaterThan(8); expect(cuts.capture).toBeGreaterThan(5);
  }, 60_000);
});
