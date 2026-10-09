import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getFleetDashboard, requestOperationalAction } from "../../src/modules/operations-control/server.ts";
import { freezeMutatingJobs, unfreezeMutatingJobs } from "../../src/modules/platform-operations/server.ts";
import { hashProjectAckToken } from "../../src/modules/snapshot-delivery/index.ts";
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
    const syntheticAckHash = hashProjectAckToken(`${secretMarker}_SYNTHETIC_ACK_TOKEN`);
    const manifestKey = `snapshots/private/${suffix}/manifest.json`;
    const recent = new Date();
    const setup = await runInPrincipalDatabaseTransaction(principal, async (transaction) => {
      const organization = await transaction.organization.create({ data: { name: `Fleet Org ${suffix}`, slug: `fleet-org-${suffix}` } });
      const project = await transaction.project.create({ data: { organizationId: organization.id, name: `Fleet Project ${suffix}`, slug: `fleet-project-${suffix}` } });
      await transaction.projectAckCredential.create({ data: { organizationId: organization.id, projectId: project.id, currentTokenHash: syntheticAckHash } });
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
        },
      });
      const revision = await transaction.sourceRevision.create({ data: {
        organizationId: organization.id, projectId: project.id, sourceId: source.id, sourceVersion: source.version,
        adapterKey: source.adapterKey, adapterVersion: source.adapterVersion, profileKey: source.profileKey, profileVersion: source.profileVersion,
        safetyPolicy: {}, rawStorageKey: `sources/${"a".repeat(64)}`, rawArtifactHash: "a".repeat(64), rawByteCount: 0,
        normalizedContentHash: "b".repeat(64), recordCount: 0, invalidRecordCount: 0,
      } });
      await transaction.sourceRevision.update({ where: { id: revision.id }, data: { status: "STAGED" } });
      await transaction.sourceRevision.update({ where: { id: revision.id }, data: { status: "GOOD", sequence: 1, completedAt: recent } });
      await transaction.source.update({ where: { id: source.id }, data: { lastGoodRevisionId: revision.id } });
      await transaction.sourceCredentialRef.create({ data: { organizationId: organization.id, projectId: project.id, sourceId: source.id, endpointCredentialRefName: secretMarker } });
      await transaction.projectCurrentSnapshotManifest.create({ data: { organizationId: organization.id, projectId: project.id, publishSequence: 3, manifestKey, manifestSha256: "a".repeat(64), publishedAt: new Date("2026-10-05T08:05:00.000Z") } });
      await transaction.deliveryRun.create({ data: { organizationId: organization.id, projectId: project.id, publishSequence: 3, manifestKey, manifestSha256: "a".repeat(64), status: "APPLIED", publishedAt: new Date("2026-10-05T08:05:00.000Z"), appliedAt: new Date("2026-10-05T08:06:00.000Z") } });
      await transaction.projectSnapshotSequence.create({ data: { organizationId: organization.id, projectId: project.id, lastReservedSequence: 3 } });
      const event = await transaction.outboxEvent.create({ data: { organizationId: organization.id, topic: "fleet.synthetic", payload: { projectId: project.id }, status: "DEAD_LETTER", correlationId: randomUUID() } });
      await transaction.jobRun.create({ data: { organizationId: organization.id, outboxEventId: event.id, jobType: "fleet.synthetic", status: "FAILED", attempt: 2, workerId: "test-worker", startedAt: new Date("2026-10-05T08:07:00.000Z"), finishedAt: new Date("2026-10-05T08:08:00.000Z"), safeErrorCode: "SYNTHETIC_TIMEOUT", correlationId: randomUUID() } });
      await transaction.notification.create({ data: { organizationId: organization.id, projectId: project.id,
        category: "PROJECT", severity: "WARNING", visibility: "PLATFORM_ADMIN_ONLY", title: "Импорт требует решения",
        message: "Импорт остановлен как SUSPICIOUS и ожидает ручного решения.", route: "/admin/fleet/",
        sourceType: "SourceRevision", sourceId: revision.id, dedupKey: `fleet-alert-${suffix}`, occurredAt: recent } });
      return { organizationId: organization.id, projectId: project.id, sourceId: source.id, revisionId: revision.id };
    });

    const buildInput = { action: "SNAPSHOT_BUILD" as const, organizationId: setup.organizationId, projectId: setup.projectId, sourceId: "", sourceRevisionId: "", reason: "", idempotencyKey: `fleet-build-${suffix}` };
    const build = await requestOperationalAction(principal, buildInput);
    await expect(requestOperationalAction(principal, buildInput)).resolves.toEqual({ ...build, duplicate: true });
    await expect(requestOperationalAction(principal, { ...buildInput, action: "SNAPSHOT_PUBLISH", buildInputId: "selected-stage" })).rejects.toThrow("OPERATIONS_CONTROL_IDEMPOTENCY_CONFLICT");
    await expect(requestOperationalAction(tenant(setup.organizationId), { ...buildInput, action: "ACK_ROTATE", ackRotationPhase: "STAGE", ackCredentialVersion: 1, idempotencyKey: `fleet-tenant-${suffix}` })).rejects.toThrow("OPERATIONS_CONTROL_ADMIN_ACCESS_DENIED");
    await expect(requestOperationalAction(principal, { ...buildInput, action: "RUN_SOURCE", sourceId: setup.sourceId, idempotencyKey: `fleet-source-${suffix}` })).resolves.toMatchObject({ duplicate: false });
    await freezeMutatingJobs(principal, { reason: "Synthetic integration safety check" });
    await expect(unfreezeMutatingJobs(principal, {})).rejects.toThrow("DATA_SAFETY_RECONCILE_REQUIRED");

    const dashboard = await getFleetDashboard(principal);
    const project = dashboard.projects.find((item) => item.projectId === setup.projectId);
    expect(project).toMatchObject({ organizationId: setup.organizationId, ackCredentialVersion: 1, currentSnapshot: { publishSequence: 3 }, latestDelivery: { publishSequence: 3, status: "APPLIED", acknowledgedAt: null } });
    expect(project?.sources[0]).toMatchObject({ health: "GOOD", hasLastGoodRevision: true,
      latestImport: { status: "GOOD", recordCount: 0, invalidRecordCount: 0, failureCode: null } });
    expect(project?.operationalRequests).toEqual([expect.objectContaining({ requestId: build.requestId, action: "SNAPSHOT_BUILD", status: "REQUESTED", startedAt: null, finishedAt: null })]);
    expect(dashboard.failedJobs.some((job) => job.safeErrorCode === "SYNTHETIC_TIMEOUT")).toBe(true);
    expect(dashboard.alerts.some((alert) => alert.title === "Импорт требует решения"
      && alert.projectName === `Fleet Project ${suffix}`)).toBe(true);
    expect(dashboard.dataSafety.jobsFrozen).toBe(true);
    expect(dashboard.auditEvents.some((event) => event.action === "operations-control.snapshot.build.request")).toBe(true);
    expect(dashboard.auditEvents.some((event) => event.action === "source.manual-run.request")).toBe(true);
    expect(dashboard.auditEvents.some((event) => event.action === "data-safety.freeze")).toBe(true);
    await runInPrincipalDatabaseTransaction(principal, async (transaction) => {
      const request = await transaction.operationalActionRequest.findUniqueOrThrow({ where: { id: build.requestId } });
      expect(request).toMatchObject({ organizationId: setup.organizationId, projectId: setup.projectId,
        sourceId: null, action: "SNAPSHOT_BUILD", status: "REQUESTED" });
      if (!request.outboxEventId) throw new Error("SYNTHETIC_INTENT_MISSING");
      const intent = await transaction.outboxEvent.findUniqueOrThrow({ where: { id: request.outboxEventId } });
      expect(intent).toMatchObject({ organizationId: setup.organizationId,
        topic: "operations-control.snapshot.build.request", status: "PENDING", schemaVersion: 1 });
      expect(intent.payload).toEqual({ schemaVersion: 1, organizationId: setup.organizationId,
        projectId: setup.projectId, requestId: build.requestId, action: "SNAPSHOT_BUILD" });
      expect(await transaction.operationalActionRequest.count({ where: { projectId: setup.projectId } })).toBe(1);
      expect(await transaction.outboxEvent.count({ where: { organizationId: setup.organizationId,
        topic: { startsWith: "operations-control." } } })).toBe(1);
    });
    const serialized = JSON.stringify(dashboard);
    expect(serialized).not.toContain(secretMarker);
    expect(serialized).not.toContain(syntheticAckHash);
    expect(serialized).not.toContain(manifestKey);
    expect(serialized).not.toContain(setup.revisionId);
    expect(serialized).not.toContain("manifestSha256");
    expect(serialized).not.toContain("currentTokenHash");
    expect(serialized).not.toContain("nextTokenHash");
    for (const privateField of ["requestedBy", "requestHash", "idempotencyKeyHash", "leaseWorkerId", "reason", "result"]) expect(serialized).not.toContain(`"${privateField}"`);
  });
});
