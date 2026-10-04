import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PrismaSnapshotDeliveryRepository } from "../../src/modules/snapshot-delivery/server.ts";
import type { PlatformAdminPrincipal, TenantUserPrincipal } from "../../src/platform/authorization/principal.ts";
import { runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";

function admin(): PlatformAdminPrincipal {
  return { kind: "platform-admin", userId: `delivery-admin-${randomUUID()}`, correlationId: randomUUID() };
}

function tenant(organizationId: string, projectIds: readonly string[]): TenantUserPrincipal {
  return {
    kind: "tenant-user",
    userId: `delivery-tenant-${randomUUID()}`,
    membershipId: `delivery-member-${randomUUID()}`,
    organizationId,
    role: "ORG_VIEWER",
    projectIds,
    correlationId: randomUUID(),
  };
}

describe("snapshot delivery persistence", () => {
  it("persists current manifest atomically, enforces transitions, stale cutoff, and project RLS", async () => {
    const principal = admin();
    const suffix = randomUUID().slice(0, 8);
    const setup = await runInPrincipalDatabaseTransaction(principal, async (transaction) => {
      const organization = await transaction.organization.create({ data: { name: `Delivery Org ${suffix}`, slug: `delivery-org-${suffix}` } });
      const projectA = await transaction.project.create({ data: { organizationId: organization.id, name: `Delivery A ${suffix}`, slug: `delivery-a-${suffix}` } });
      const projectB = await transaction.project.create({ data: { organizationId: organization.id, name: `Delivery B ${suffix}`, slug: `delivery-b-${suffix}` } });
      const repository = new PrismaSnapshotDeliveryRepository(transaction);
      const run = await repository.publishCurrentAndCreateRun({
        organizationId: organization.id,
        projectId: projectA.id,
        publishSequence: 1,
        manifestKey: `snapshots/${projectA.id}/${"a".repeat(64)}`,
        manifestSha256: "a".repeat(64),
        publishedAt: new Date("2026-10-05T00:00:00.000Z"),
      });
      return { organizationId: organization.id, projectAId: projectA.id, projectBId: projectB.id, run };
    });

    await runInPrincipalDatabaseTransaction(principal, async (transaction) => {
      const repository = new PrismaSnapshotDeliveryRepository(transaction);
      const downloaded = await repository.transitionRun({
        organizationId: setup.organizationId,
        projectId: setup.projectAId,
        publishSequence: 1,
        expectedStatuses: ["PENDING"],
        nextStatus: "DOWNLOADED",
        occurredAt: new Date("2026-10-05T00:01:00.000Z"),
      });
      expect(downloaded.status).toBe("DOWNLOADED");
      await expect(repository.transitionRun({
        organizationId: setup.organizationId,
        projectId: setup.projectAId,
        publishSequence: 1,
        expectedStatuses: ["DOWNLOADED"],
        nextStatus: "ACKNOWLEDGED",
        occurredAt: new Date("2026-10-05T00:02:00.000Z"),
      })).rejects.toThrow("DELIVERY_TRANSITION_INVALID");
      await transaction.deliveryRun.update({
        where: { organizationId_projectId_publishSequence: { organizationId: setup.organizationId, projectId: setup.projectAId, publishSequence: 1 } },
        data: { createdAt: new Date("2026-10-03T00:00:00.000Z") },
      });
      await expect(repository.markStaleBefore(
        new Date("2026-10-04T00:00:00.000Z"),
        new Date("2026-10-05T00:00:00.000Z"),
      )).resolves.toBe(1);
      await expect(repository.publishCurrentAndCreateRun({
        organizationId: setup.organizationId,
        projectId: setup.projectAId,
        publishSequence: 1,
        manifestKey: `snapshots/${setup.projectAId}/${"b".repeat(64)}`,
        manifestSha256: "b".repeat(64),
        publishedAt: new Date("2026-10-05T01:00:00.000Z"),
      })).rejects.toThrow("SNAPSHOT_DELIVERY_SEQUENCE_STALE");
    });

    await runInPrincipalDatabaseTransaction(tenant(setup.organizationId, [setup.projectAId]), async (transaction) => {
      const repository = new PrismaSnapshotDeliveryRepository(transaction);
      await expect(repository.getCurrentManifest(setup.organizationId, setup.projectAId)).resolves.toMatchObject({ publishSequence: 1 });
      await expect(repository.getCurrentManifest(setup.organizationId, setup.projectBId)).resolves.toBeNull();
    });
  });
});
