import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { inventoryIdentityCommands } from "../../src/modules/ingestion-core/server.ts";
import type { JobPrincipal, PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";
import { runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function admin(): PlatformAdminPrincipal {
  return { kind: "platform-admin", userId: `inventory-admin-${randomUUID()}`, correlationId: randomUUID() };
}

describe("inventory identity lifecycle persistence", () => {
  it("preserves identity through grace and writes only real lifecycle events", async () => {
    const principal = admin();
    const suffix = randomUUID().slice(0, 8);
    const scope = await runInPrincipalDatabaseTransaction(principal, async (transaction) => {
      const organization = await transaction.organization.create({ data: { name: `Inventory Org ${suffix}`, slug: `inventory-org-${suffix}` } });
      const project = await transaction.project.create({ data: { organizationId: organization.id, name: `Inventory Project ${suffix}`, slug: `inventory-project-${suffix}` } });
      const source = await transaction.source.create({
        data: {
          organizationId: organization.id,
          projectId: project.id,
          sourceKey: `inventory-${suffix}`,
          name: "Synthetic inventory source",
          adapterKey: "yrl-realty-2010",
          adapterVersion: "1.0.0",
          profileKey: "default-v1",
          profileVersion: "1.0.0",
          datasetType: "MIXED_REALTY",
          schedulePolicy: { mode: "MANUAL_ONLY" },
        },
      });
      return { organizationId: organization.id, projectId: project.id, sourceId: source.id };
    });
    const job: JobPrincipal = {
      kind: "job",
      jobName: "inventory-lifecycle-fixture",
      organizationId: scope.organizationId,
      projectIds: [scope.projectId],
      correlationId: randomUUID(),
    };
    const identity = { ...scope, externalOfferId: "offer-42" };
    const first = await inventoryIdentityCommands.recordSeen(job, {
      ...identity,
      sourceHash: HASH_A,
      normalizedHash: HASH_A,
      seenAt: new Date("2026-10-01T00:00:00.000Z"),
    });
    const policy = { deactivationEnabled: true, inactiveAfterMissingGoodRuns: 2, inactiveAfterMissingHours: 24 };
    const grace = await inventoryIdentityCommands.recordMissing(job, identity, policy, {
      completedGoodRun: true,
      baseline: false,
      suspicious: false,
      occurredAt: new Date("2026-10-01T01:00:00.000Z"),
    });
    expect(grace).toMatchObject({ uid: first.uid, status: "ACTIVE", missingGoodRuns: 1 });
    expect(await runInPrincipalDatabaseTransaction(principal, (transaction) => transaction.inventoryLifecycleEvent.count({ where: { inventoryUid: first.uid } }))).toBe(0);

    const returned = await inventoryIdentityCommands.recordSeen(job, {
      ...identity,
      sourceHash: HASH_B,
      normalizedHash: HASH_B,
      seenAt: new Date("2026-10-01T02:00:00.000Z"),
    });
    expect(returned).toMatchObject({ uid: first.uid, status: "ACTIVE", missingGoodRuns: 0, missingSince: null });
    expect(await runInPrincipalDatabaseTransaction(principal, (transaction) => transaction.inventoryLifecycleEvent.count({ where: { inventoryUid: first.uid } }))).toBe(0);

    await inventoryIdentityCommands.recordMissing(job, identity, policy, {
      completedGoodRun: true, baseline: false, suspicious: false,
      occurredAt: new Date("2026-10-01T03:00:00.000Z"),
    });
    const inactive = await inventoryIdentityCommands.recordMissing(job, identity, policy, {
      completedGoodRun: true, baseline: false, suspicious: false,
      occurredAt: new Date("2026-10-02T03:00:00.000Z"),
    });
    expect(inactive).toMatchObject({ uid: first.uid, status: "INACTIVE", missingGoodRuns: 2 });

    const reactivated = await inventoryIdentityCommands.recordSeen(job, {
      ...identity,
      sourceHash: HASH_B,
      normalizedHash: HASH_B,
      seenAt: new Date("2026-10-02T04:00:00.000Z"),
    });
    expect(reactivated).toMatchObject({ uid: first.uid, status: "ACTIVE" });
    const events = await runInPrincipalDatabaseTransaction(principal, (transaction) => transaction.inventoryLifecycleEvent.findMany({
      where: { inventoryUid: first.uid }, orderBy: { occurredAt: "asc" }, select: { type: true },
    }));
    expect(events).toEqual([{ type: "INACTIVATED" }, { type: "REACTIVATED" }]);
  });
});
