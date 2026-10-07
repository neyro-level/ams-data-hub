import { randomUUID } from "node:crypto";
import { createUlid } from "@ams-data-hub/data-contracts";
import { describe, expect, it, vi } from "vitest";

const cuts = vi.hoisted(() => ({ commands: 0, capture: 0 }));
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
      }
      return execute(tx);
    }, options);
  return { ...actual, runInPrincipalDatabaseTransaction: principal, runInAuthorizedDatabaseTransaction: authorized };
});
import { projectUrlRegistryCommands } from "../../src/modules/project-state/server.ts";
import { captureSnapshotInput, createSnapshotCandidateAssemblyServer } from "../../src/modules/snapshot-delivery/server.ts";
import { composeSnapshot } from "../../src/modules/snapshot-delivery/index.ts";
import { runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";
import { createProjectJobPrincipal } from "../../src/platform/authorization/principal-factories.ts";
import type { PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";

describe("persistent Hub URL commands through captured snapshot composition", () => {
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
