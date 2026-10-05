import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getFleetDashboard, requestOperationalAction } from "../../src/modules/operations-control/server.ts";
import { freezeMutatingJobs, unfreezeMutatingJobs } from "../../src/modules/platform-operations/server.ts";
import type { PlatformAdminPrincipal, TenantUserPrincipal } from "../../src/platform/authorization/principal.ts";
import { runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";

function admin(): PlatformAdminPrincipal {
  return { kind: "platform-admin", userId: `fleet-admin-${randomUUID()}`, correlationId: randomUUID() };
}

function tenant(organizationId: string): TenantUserPrincipal {
  return { kind: "tenant-user", userId: `fleet-tenant-${randomUUID()}`, organizationId, membershipId: `fleet-member-${randomUUID()}`, role: "ORG_ADMIN", projectIds: "*", correlationId: randomUUID() };
}

describe("fleet dashboard persistence projection", () => {
  it("reads cross-project operational state without exposing storage or source secrets", async () => {
    const principal = admin();
    const suffix = randomUUID().slice(0, 8);
    const secretMarker = `SYNTHETIC_SECRET_${suffix.toUpperCase()}`;
    const manifestKey = `snapshots/private/${suffix}/manifest.json`;
    const recent = new Date();
    const setup = await runInPrincipalDatabaseTransaction(principal, async (transaction) => {
      const organization = await transaction.organization.create({ data: { name: `Fleet Org ${suffix}`, slug: `fleet-org-${suffix}` } });
      const project = await transaction.project.create({ data: { organizationId: organization.id, name: `Fleet Project ${suffix}`, slug: `fleet-project-${suffix}` } });
      const source = await transaction.source.create({
        data: {
          organizationId: organization.id,
          projectId: project.id,
          sourceKey: `fleet-${suffix}`,
          name: "Fleet synthetic source",
          adapterKey: "yrl-realty-2010",
          adapterVersion: "1.0.0",
          profileKey: "default-v1",
          profileVersion: "1.0.0",
          datasetType: "MIXED_REALTY",
          schedulePolicy: { mode: "SCHEDULED", cadenceMinutes: 60 },
          enabled: true,
          lastAttemptAt: recent,
          lastSuccessAt: recent,
          lastGoodRevisionId: "good-revision-1",
        },
      });
      await transaction.sourceCredentialRef.create({ data: { organizationId: organization.id, projectId: project.id, sourceId: source.id, endpointCredentialRefName: secretMarker } });
      await transaction.projectCurrentSnapshotManifest.create({ data: { organizationId: organization.id, projectId: project.id, publishSequence: 3, manifestKey, manifestSha256: "a".repeat(64), publishedAt: new Date("2026-10-05T08:05:00.000Z") } });
      await transaction.deliveryRun.create({ data: { organizationId: organization.id, projectId: project.id, publishSequence: 3, manifestKey, manifestSha256: "a".repeat(64), status: "APPLIED", publishedAt: new Date("2026-10-05T08:05:00.000Z"), appliedAt: new Date("2026-10-05T08:06:00.000Z") } });
      const event = await transaction.outboxEvent.create({ data: { organizationId: organization.id, topic: "fleet.synthetic", payload: { projectId: project.id }, status: "DEAD_LETTER", correlationId: randomUUID() } });
      await transaction.jobRun.create({ data: { organizationId: organization.id, outboxEventId: event.id, jobType: "fleet.synthetic", status: "FAILED", attempt: 2, workerId: "test-worker", startedAt: new Date("2026-10-05T08:07:00.000Z"), finishedAt: new Date("2026-10-05T08:08:00.000Z"), safeErrorCode: "SYNTHETIC_TIMEOUT", correlationId: randomUUID() } });
      return { organizationId: organization.id, projectId: project.id, sourceId: source.id };
    });

    const buildInput = { action: "SNAPSHOT_BUILD" as const, organizationId: setup.organizationId, projectId: setup.projectId, sourceId: "", sourceRevisionId: "", reason: "", idempotencyKey: `fleet-build-${suffix}` };
    const build = await requestOperationalAction(principal, buildInput);
    await expect(requestOperationalAction(principal, buildInput)).resolves.toEqual({ ...build, duplicate: true });
    await expect(requestOperationalAction(principal, { ...buildInput, action: "SNAPSHOT_PUBLISH" })).rejects.toThrow("OPERATIONS_CONTROL_IDEMPOTENCY_CONFLICT");
    await expect(requestOperationalAction(tenant(setup.organizationId), { ...buildInput, action: "ACK_ROTATE", idempotencyKey: `fleet-tenant-${suffix}` })).rejects.toThrow("OPERATIONS_CONTROL_ADMIN_ACCESS_DENIED");
    await expect(requestOperationalAction(principal, { ...buildInput, action: "RUN_SOURCE", sourceId: setup.sourceId, idempotencyKey: `fleet-source-${suffix}` })).resolves.toMatchObject({ duplicate: false });
    await freezeMutatingJobs(principal, { reason: "Synthetic integration safety check" });
    await expect(unfreezeMutatingJobs(principal, {})).rejects.toThrow("DATA_SAFETY_RECONCILE_REQUIRED");

    const dashboard = await getFleetDashboard(principal);
    const project = dashboard.projects.find((item) => item.projectId === setup.projectId);
    expect(project).toMatchObject({ organizationId: setup.organizationId, currentSnapshot: { publishSequence: 3 }, latestDelivery: { publishSequence: 3, status: "APPLIED", acknowledgedAt: null } });
    expect(project?.sources[0]).toMatchObject({ health: "GOOD", hasLastGoodRevision: true });
    expect(dashboard.failedJobs.some((job) => job.safeErrorCode === "SYNTHETIC_TIMEOUT")).toBe(true);
    expect(dashboard.dataSafety.jobsFrozen).toBe(true);
    expect(dashboard.auditEvents.some((event) => event.action === "operations-control.snapshot.build.request")).toBe(true);
    expect(dashboard.auditEvents.some((event) => event.action === "source.manual-run.request")).toBe(true);
    expect(dashboard.auditEvents.some((event) => event.action === "data-safety.freeze")).toBe(true);
    const operationalOutbox = await runInPrincipalDatabaseTransaction(principal, (transaction) => transaction.outboxEvent.count({ where: { topic: { startsWith: "operations-control." } } }));
    expect(operationalOutbox).toBe(0);
    const serialized = JSON.stringify(dashboard);
    expect(serialized).not.toContain(secretMarker);
    expect(serialized).not.toContain(manifestKey);
    expect(serialized).not.toContain("manifestSha256");
  });
});
