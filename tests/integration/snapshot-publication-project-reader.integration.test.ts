import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { createUlid } from "@ams-data-hub/data-contracts";
import { describe, expect, it, vi } from "vitest";
import { readTestDatabaseTarget } from "../../scripts/verify-test-database-env.mjs";
import { Prisma } from "../../src/generated/prisma/client.ts";
import { captureSnapshotInput } from "../../src/modules/snapshot-delivery/server.ts";
import { validateSnapshotInput } from "../../src/modules/snapshot-delivery/index.ts";
import { snapshotRequiresProjectContact } from "../../src/modules/snapshot-delivery/application/snapshot-project-contact.ts";
import { prepareSnapshotPublicationProjectAnchors } from "../../src/modules/project-state/index.ts";
import { createSnapshotPublicationProjectReader } from "../../src/modules/project-state/server.ts";
import { analyzeImportSafety, BOOTSTRAP_SOURCE_SAFETY_POLICY } from "../../src/modules/ingestion-core/index.ts";
import { lockSnapshotPublication } from "../../src/modules/snapshot-delivery/infrastructure/snapshot-publication-lock.ts";
import { createProjectJobPrincipal } from "../../src/platform/authorization/principal-factories.ts";
import { runInAuthorizedDatabaseTransaction, runInPrincipalDatabaseTransaction, type DatabaseTransaction } from "../../src/platform/database/transaction.ts";
import type { PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";

const admin: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-project-admission", correlationId: randomUUID() };
async function fixture(bound = true, contact = true) {
  const setup = await runInPrincipalDatabaseTransaction(admin, async (tx) => {
    const suffix = randomUUID().slice(0, 8);
    const org = await tx.organization.create({ data: { name: "Synthetic project admission", slug: `admit-${suffix}` } });
    const project = await tx.project.create({ data: { organizationId: org.id, name: "Synthetic admission", slug: `admit-${suffix}` } });
    const foreign = await tx.project.create({ data: { organizationId: org.id, name: "Synthetic foreign", slug: `admit-b-${suffix}` } });
    const scope = { organizationId: org.id, projectId: project.id };
    await tx.dataSafetyState.upsert({ where: { id: "global" }, create: { id: "global", jobsFrozen: false, unfrozenAt: new Date() },
      update: { jobsFrozen: false, unfrozenAt: new Date() } });
    await tx.projectCatalogSubscription.create({ data: { ...scope, mode: "CURATED", cities: { create: { cityUid: "01M41T6Q04BADHXSERJHZFXKCH" } } } });
    if (contact) await tx.projectPublicContact.create({ data: { ...scope, phone: "+70000000000", messengers: [] } });
    const agent = await tx.agent.create({ data: { ...scope, uid: createUlid(), slug: "synthetic-published", fullName: "Synthetic published Agent",
      showOnSite: true, status: "ACTIVE", consentConfirmedAt: new Date("2026-10-07T01:02:03.789Z") } });
    const other = await tx.agent.create({ data: { ...scope, uid: createUlid(), slug: "synthetic-unpublished", fullName: "Synthetic unpublished", showOnSite: false } });
    const source = await tx.source.create({ data: { ...scope, sourceKey: "synthetic-admission", name: "Synthetic admission",
      adapterKey: "yrl-realty-2010", adapterVersion: "1.0.0", profileKey: "vladis-vt24-v1", profileVersion: "1.0.0",
      datasetType: "RESALE", schedulePolicy: { mode: "MANUAL_ONLY" } } });
    const target = { ...scope, sourceId: source.id }; const inventoryUid = createUlid(); const recordHash = "b".repeat(64);
    const analysis = analyzeImportSafety({ recordCount: 1, previousGoodRecordCount: null, invalidRecordCount: 0, issues: [] }, BOOTSTRAP_SOURCE_SAFETY_POLICY);
    const revision = await tx.sourceRevision.create({ data: { ...target, sourceVersion: 1, adapterKey: source.adapterKey,
      adapterVersion: source.adapterVersion, profileKey: source.profileKey, profileVersion: source.profileVersion,
      safetyPolicy: BOOTSTRAP_SOURCE_SAFETY_POLICY, safetyAnalysis: JSON.parse(JSON.stringify(analysis)) as Prisma.InputJsonObject, recordCount: 1 } });
    await tx.sourceRevisionRecord.create({ data: { ...target, revisionId: revision.id, externalId: "synthetic-private",
      orderKey: "73796e746865746963", inventoryUid, recordHash, payload: { schemaVersion: 1, draft: { imageUrls: [] }, fields: {} } } });
    await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "STAGED", sequence: 1,
      rawStorageKey: "private-synthetic/admission", rawArtifactHash: "a".repeat(64), rawByteCount: 1, normalizedContentHash: recordHash, completedAt: new Date() } });
    await tx.sourceRevision.update({ where: { id: revision.id }, data: { status: "GOOD" } });
    await tx.source.update({ where: { id: source.id }, data: { lastGoodRevisionId: revision.id } });
    await tx.inventoryIdentity.create({ data: { ...target, uid: inventoryUid, externalOfferId: "synthetic-private",
      normalizedHash: recordHash, sourceHash: "a".repeat(64), firstSeenAt: new Date(), lastSeenAt: new Date() } });
    const binding = bound ? await tx.listingAgentBinding.create({ data: { ...target, inventoryUid, sourceRevisionId: revision.id,
      recordHash, agentUid: agent.uid } }) : null;
    return { scope, foreignId: foreign.id, agentUid: agent.uid, otherUid: other.uid, inventoryUid, bindingId: binding?.id };
  });
  const receipt = await captureSnapshotInput(createProjectJobPrincipal({ ...setup.scope, jobName: "snapshot-input" }),
    { ...setup.scope, idempotencyKey: "synthetic-project-admission", schemaMinor: 0 });
  const parts = validateSnapshotInput(receipt);
  const rows = (kind: string) => parts.filter((part) => part.kind === kind).flatMap((part) => part.payload);
  const bindings = setup.bindingId ? new Map([[setup.inventoryUid, setup.agentUid]]) : new Map<string, string>();
  const anchors = prepareSnapshotPublicationProjectAnchors({ project: rows("project"), contacts: rows("contacts"), agents: rows("agents"),
    links: rows("listing-links"), publishedAgentUids: new Set([setup.agentUid]), publishedBindings: bindings,
    requiresContact: snapshotRequiresProjectContact([setup.inventoryUid], bindings) });
  return { ...setup, anchors };
}
function publication<T>(scope: { organizationId: string; projectId: string }, execute: (tx: DatabaseTransaction) => Promise<T>,
  projects: readonly string[] | "*" = [scope.projectId], principalKind: "project-job" | "job" = "project-job", actorId = "snapshot-publication") {
  return runInAuthorizedDatabaseTransaction({ principalKind, actorId, organizationId: scope.organizationId,
    projectIds: projects, correlationId: randomUUID() }, async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
    expect(await tx.$queryRawUnsafe("SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname=current_user"))
      .toEqual([{ rolbypassrls: false, rolsuper: false }]);
    await lockSnapshotPublication(tx, scope); return execute(tx);
  }, { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 5000 });
}
describe("actual NOBYPASS publication project admission", () => {
  it("accepts exact captured bindings without whole project-version or new-agent enrichment", async () => {
    const setup = await fixture();
    await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      await tx.project.update({ where: { id: setup.scope.projectId }, data: { name: "Synthetic renamed", version: { increment: 1 } } });
      await tx.agent.update({ where: { uid: setup.otherUid }, data: { showOnSite: true, consentConfirmedAt: new Date() } });
    });
    await publication(setup.scope, async (tx) => {
      const project = vi.spyOn(tx.project, "findFirst"); const contact = vi.spyOn(tx.projectPublicContact, "findUnique");
      const agents = vi.spyOn(tx.agent, "findMany"); const bindings = vi.spyOn(tx.listingAgentBinding, "findMany");
      try {
        await createSnapshotPublicationProjectReader(tx)(setup.scope, setup.anchors);
        expect(project.mock.calls.map(([args]) => args?.select)).toEqual([{ status: true, serviceState: true }]);
        expect(contact.mock.calls.map(([args]) => args?.select)).toEqual([{ version: true }]);
        expect(agents.mock.calls.map(([args]) => Object.keys(args!.select!).sort().join(",")))
          .toEqual(["consentConfirmedAt,feedPhotoMediaId,photoMediaId,showOnSite,status,uid,version"]);
        expect(bindings.mock.calls.map(([args]) => Object.keys(args!.select!).sort().join(",")))
          .toEqual(["agentUid,inventoryUid,recordHash,sourceId,sourceRevisionId"]);
      } finally { project.mockRestore(); contact.mockRestore(); agents.mockRestore(); bindings.mockRestore(); }
    });
  });
  it("holds a stable admission cut while an owned actual consent writer waits, then rejects its committed mutation", async () => {
    const setup = await fixture(); const target = readTestDatabaseTarget(process.env, { allowApplicationTarget: true });
    const writer = new pg.Client({ host: target.host, port: target.port, database: target.database, user: target.user,
      password: target.password, ssl: target.sslmode === "require", options: "-c timezone=UTC" });
    await writer.connect(); let pending: Promise<{ error: unknown; count: number | null }> | undefined;
    try {
      await writer.query("BEGIN"); await writer.query("SET LOCAL ROLE ams_data_hub_web");
      await writer.query("SET LOCAL lock_timeout = '2s'");
      await writer.query("SELECT set_config('app.principal_kind','platform-admin',true)");
      expect((await writer.query("SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname=current_user")).rows)
        .toEqual([{ rolbypassrls: false, rolsuper: false }]);
      const pid = (await writer.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      await publication(setup.scope, async (tx) => {
        const read = createSnapshotPublicationProjectReader(tx); await read(setup.scope, setup.anchors);
        pending = writer.query('UPDATE "Agent" SET "showOnSite"=false, "consentConfirmedAt"=NULL WHERE "uid"=$1', [setup.agentUid])
          .then((result) => ({ error: null, count: result.rowCount }), (error: unknown) => ({ error, count: null }));
        let waiting = false; const deadline = Date.now() + 1500;
        while (Date.now() < deadline) {
          const locks = await tx.$queryRaw<{ pid: number }[]>(Prisma.sql`
            SELECT w.pid FROM pg_locks w JOIN pg_locks owner ON w.locktype=owner.locktype AND w.database=owner.database
              AND w.classid=owner.classid AND w.objid=owner.objid AND w.objsubid=owner.objsubid
            WHERE owner.pid=pg_backend_pid() AND owner.locktype='advisory' AND owner.granted AND NOT w.granted AND w.pid=${pid}`);
          if (locks.length) { waiting = true; break; } await delay(20);
        }
        expect(waiting).toBe(true); await read(setup.scope, setup.anchors);
      });
      expect(await pending).toEqual({ error: null, count: 1 }); await writer.query("COMMIT");
      await expect(publication(setup.scope, (tx) => createSnapshotPublicationProjectReader(tx)(setup.scope, setup.anchors)))
        .rejects.toThrow("SNAPSHOT_PUBLICATION_PROJECT_STALE");
    } finally { if (pending) await pending; await writer.query("ROLLBACK"); await writer.end(); }
  });
  it("accepts optional absent-contact addition but preserves required fallback", async () => {
    const optional = await fixture(true, false);
    expect(optional.anchors).toMatchObject({ requiresContact: false, contactVersion: null });
    await runInPrincipalDatabaseTransaction(admin, (tx) => tx.projectPublicContact.create({ data: { ...optional.scope, phone: "+70000000000", messengers: [] } }));
    await publication(optional.scope, (tx) => createSnapshotPublicationProjectReader(tx)(optional.scope, optional.anchors));
    const required = await fixture(false, true);
    expect(required.anchors).toMatchObject({ requiresContact: true, contactVersion: 1 });
    await publication(required.scope, (tx) => createSnapshotPublicationProjectReader(tx)(required.scope, required.anchors));
  });
  it.each(["freeze", "disabled", "suspended", "contact-delete", "contact-version", "consent", "consent-time", "hidden", "departed", "version", "photo", "feed-photo", "binding-delete", "binding-replace"])("rejects changed %s", async (mode) => {
    const setup = await fixture(!mode.startsWith("contact"));
    await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      if (mode === "freeze") await tx.dataSafetyState.update({ where: { id: "global" }, data: { jobsFrozen: true } });
      if (mode === "disabled") await tx.project.update({ where: { id: setup.scope.projectId }, data: { status: "DISABLED" } });
      if (mode === "suspended") await tx.project.update({ where: { id: setup.scope.projectId }, data: { serviceState: "SUSPENDED" } });
      if (mode === "contact-delete") await tx.projectPublicContact.delete({ where: { organizationId_projectId: setup.scope } });
      if (mode === "contact-version") await tx.projectPublicContact.update({ where: { organizationId_projectId: setup.scope }, data: { version: { increment: 1 } } });
      if (mode === "consent") await tx.agent.update({ where: { uid: setup.agentUid }, data: { consentConfirmedAt: null } });
      if (mode === "consent-time") await tx.agent.update({ where: { uid: setup.agentUid }, data: { consentConfirmedAt: new Date("2026-10-07T01:02:03.790Z") } });
      if (mode === "hidden") await tx.agent.update({ where: { uid: setup.agentUid }, data: { showOnSite: false } });
      if (mode === "departed") await tx.agent.update({ where: { uid: setup.agentUid }, data: { status: "DEPARTED" } });
      if (mode === "version") await tx.agent.update({ where: { uid: setup.agentUid }, data: { version: { increment: 1 } } });
      if (mode === "photo") await tx.agent.update({ where: { uid: setup.agentUid }, data: { photoMediaId: "synthetic-reassigned" } });
      if (mode === "feed-photo") await tx.agent.update({ where: { uid: setup.agentUid }, data: { feedPhotoMediaId: "synthetic-reassigned" } });
      if (mode === "binding-delete") await tx.listingAgentBinding.delete({ where: { id: setup.bindingId } });
      if (mode === "binding-replace") await tx.listingAgentBinding.update({ where: { id: setup.bindingId }, data: { agentUid: setup.otherUid } });
    });
    const code = mode === "freeze" ? "SNAPSHOT_PUBLICATION_JOBS_FROZEN"
      : mode === "disabled" || mode === "suspended" ? "SNAPSHOT_PUBLICATION_PROJECT_BLOCKED" : "SNAPSHOT_PUBLICATION_PROJECT_STALE";
    await expect(publication(setup.scope, (tx) => createSnapshotPublicationProjectReader(tx)(setup.scope, setup.anchors))).rejects.toThrow(code);
  });
  it("denies wildcard/multi-project/foreign scope before personal SELECTs", async () => {
    const setup = await fixture();
    await runInPrincipalDatabaseTransaction(admin, async (tx) => {
      const foreign = { organizationId: setup.scope.organizationId, projectId: setup.foreignId };
      await tx.agent.create({ data: { ...foreign, uid: createUlid(), slug: "synthetic-foreign", fullName: "Synthetic foreign Agent" } });
      await tx.projectPublicContact.create({ data: { ...foreign, phone: "+70000000000", messengers: [] } });
    });
    for (const projects of ["*", [], [setup.scope.projectId, setup.foreignId], [setup.foreignId]] as const) {
      await publication(setup.scope, async (tx) => {
        const foreignOnly = projects.length === 1 && projects[0] === setup.foreignId ? 1 : 0;
        expect(await tx.agent.count()).toBe(foreignOnly); expect(await tx.projectPublicContact.count()).toBe(foreignOnly);
        expect(await tx.listingAgentBinding.count()).toBe(0); expect(await tx.project.count()).toBe(foreignOnly);
        await expect(createSnapshotPublicationProjectReader(tx)(setup.scope, setup.anchors)).rejects.toThrow("SNAPSHOT_PUBLICATION_PROJECT_ACCESS_DENIED");
      }, projects);
    }
  });
  it("rejects legacy publication purpose and wrong actor before admission reads", async () => {
    const setup = await fixture();
    for (const [kind, actor] of [["job", "snapshot-publication"], ["project-job", "synthetic-other-job"]] as const) {
      await publication(setup.scope, async (tx) => {
        if (kind === "job") { expect(await tx.agent.count()).toBe(0); expect(await tx.projectPublicContact.count()).toBe(0); }
        const personal = vi.spyOn(tx.agent, "findMany"); const contact = vi.spyOn(tx.projectPublicContact, "findUnique");
        try {
          await expect(createSnapshotPublicationProjectReader(tx)(setup.scope, setup.anchors))
            .rejects.toThrow("SNAPSHOT_PUBLICATION_PROJECT_ACCESS_DENIED");
          expect(personal).not.toHaveBeenCalled(); expect(contact).not.toHaveBeenCalled();
        } finally { personal.mockRestore(); contact.mockRestore(); }
      }, [setup.scope.projectId], kind, actor);
    }
  });
});
