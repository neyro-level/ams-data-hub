import { describe, expect, it } from "vitest";
import {
  createOperationsActions,
  getFleetDashboardWithRepository,
  OperationsControlError,
  type FleetRepository,
  type OperationsActionRepository,
} from "../src/modules/operations-control/index.ts";
import type { DatabaseTransaction } from "../src/platform/database/transaction.ts";
import type { PrincipalContext } from "../src/platform/authorization/principal.ts";

const admin: PrincipalContext = { kind: "platform-admin", userId: "admin-1", correlationId: "corr-1" };
const now = new Date("2026-10-05T09:00:00.000Z");

function repository(): FleetRepository {
  return {
    async getPlatformCounts() { return { organizations: 2, failedJobs: 7 }; },
    async listProjects() {
      return [{
        organizationId: "org-1",
        organizationName: "AMS",
        projectId: "project-1",
        projectName: "Data Hub",
        projectSlug: "data-hub",
        projectStatus: "ACTIVE",
        serviceState: "ACTIVE",
        sources: [
          { id: "good", name: "Good", enabled: true, schedulePolicy: { mode: "SCHEDULED", cadenceMinutes: 60 }, lastAttemptAt: new Date("2026-10-05T08:30:00.000Z"), lastSuccessAt: new Date("2026-10-05T08:30:00.000Z"), lastGoodRevisionId: "rev-1" },
          { id: "stale", name: "Stale", enabled: true, schedulePolicy: { mode: "SCHEDULED", cadenceMinutes: 60 }, lastAttemptAt: new Date("2026-10-05T06:00:00.000Z"), lastSuccessAt: new Date("2026-10-05T06:00:00.000Z"), lastGoodRevisionId: "rev-2" },
          { id: "attention", name: "Attention", enabled: true, schedulePolicy: { mode: "MANUAL_ONLY" }, lastAttemptAt: new Date("2026-10-05T08:45:00.000Z"), lastSuccessAt: new Date("2026-10-05T08:00:00.000Z"), lastGoodRevisionId: "rev-3" },
        ],
        currentSnapshot: { publishSequence: 4, publishedAt: new Date("2026-10-05T08:35:00.000Z") },
        latestDelivery: { publishSequence: 4, status: "APPLIED", publishedAt: new Date("2026-10-05T08:35:00.000Z"), acknowledgedAt: null, safeErrorCode: null },
      }];
    },
    async listRecentFailedJobs(limit) {
      expect(limit).toBe(25);
      return [{ jobRunId: "job-1", organizationName: "AMS", jobType: "snapshot", attempt: 2, safeErrorCode: "TIMEOUT", startedAt: new Date("2026-10-05T08:40:00.000Z") }];
    },
    async listRecentAuditEvents(limit) {
      expect(limit).toBe(50);
      return [{ auditEventId: "audit-1", organizationName: "AMS", action: "snapshot.publish.request", entityType: "Project", createdAt: new Date("2026-10-05T08:50:00.000Z") }];
    },
    async getDataSafetyState() { return { jobsFrozen: false, frozenAt: null, reconciledAt: null }; },
  };
}

describe("operations-control fleet dashboard", () => {
  it("projects source freshness, Last Good, delivery ACK and safe job failures", async () => {
    const dashboard = await getFleetDashboardWithRepository({ principal: admin, repository: repository(), now });
    expect(dashboard.summary).toEqual({ organizations: 2, projects: 1, sources: 3, projectsWithIssues: 1, unacknowledgedDeliveries: 1, failedJobs: 7 });
    expect(dashboard.projects[0]?.sources.map((source) => [source.sourceId, source.health, source.issueCode])).toEqual([
      ["good", "GOOD", null],
      ["stale", "STALE", "STALE_SUCCESS"],
      ["attention", "ATTENTION", "LATEST_ATTEMPT_NOT_GOOD"],
    ]);
    expect(dashboard.projects[0]?.latestDelivery).toMatchObject({ status: "APPLIED", acknowledgedAt: null });
    expect(dashboard.failedJobs[0]).toMatchObject({ safeErrorCode: "TIMEOUT", organizationName: "AMS" });
    expect(dashboard.auditEvents[0]).toMatchObject({ action: "snapshot.publish.request", createdAt: "2026-10-05T08:50:00.000Z" });
    expect(dashboard.dataSafety.jobsFrozen).toBe(false);
  });

  it("denies cross-project projection to a tenant principal before reading the repository", async () => {
    let read = false;
    const guardedRepository: FleetRepository = {
      async getPlatformCounts() { read = true; return { organizations: 0, failedJobs: 0 }; },
      async listProjects() { read = true; return []; },
      async listRecentFailedJobs() { read = true; return []; },
      async listRecentAuditEvents() { read = true; return []; },
      async getDataSafetyState() { read = true; return { jobsFrozen: true, frozenAt: null, reconciledAt: null }; },
    };
    const tenant: PrincipalContext = { kind: "tenant-user", userId: "user-1", organizationId: "org-1", membershipId: "member-1", role: "ORG_ADMIN", projectIds: [], correlationId: "corr-2" };
    await expect(getFleetDashboardWithRepository({ principal: tenant, repository: guardedRepository, now })).rejects.toEqual(new OperationsControlError("OPERATIONS_CONTROL_ADMIN_ACCESS_DENIED"));
    expect(read).toBe(false);
  });
});

describe("operations-control action requests", () => {
  it("authorizes and records a normalized, idempotent operation request", async () => {
    let recorded: Parameters<OperationsActionRepository["recordRequest"]>[0] | null = null;
    const repository: OperationsActionRepository = {
      async recordRequest(input) { recorded = input; return { requestId: "audit-1", duplicate: false }; },
    };
    const actions = createOperationsActions({
      createRepository: () => repository,
      runInTransaction: async (_principal, execute) => execute({} as DatabaseTransaction),
    });
    await expect(actions.requestAction(admin, {
      action: "SNAPSHOT_ROLLBACK",
      organizationId: "org-1",
      projectId: "project-1",
      sourceId: "",
      sourceRevisionId: "",
      sourcePublishSequence: 3,
      reason: "",
      idempotencyKey: "rollback-request-1",
    })).resolves.toEqual({ requestId: "audit-1", duplicate: false });
    expect(recorded).toMatchObject({ action: "SNAPSHOT_ROLLBACK", sourcePublishSequence: 3, actorId: "admin-1", correlationId: "corr-1" });
    expect((recorded as unknown as { requestHash: string }).requestHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects tenant access and invalid suspicious evidence before persistence", async () => {
    let writes = 0;
    const repository: OperationsActionRepository = {
      async recordRequest() { writes += 1; return { requestId: "audit-1", duplicate: false }; },
    };
    const actions = createOperationsActions({
      createRepository: () => repository,
      runInTransaction: async (_principal, execute) => execute({} as DatabaseTransaction),
    });
    const tenant: PrincipalContext = { kind: "tenant-user", userId: "user-1", organizationId: "org-1", membershipId: "member-1", role: "ORG_ADMIN", projectIds: [], correlationId: "corr-2" };
    const input = { action: "SUSPICIOUS_APPROVE" as const, organizationId: "org-1", projectId: "project-1", sourceId: "source-1", sourceRevisionId: "", reason: "", idempotencyKey: "suspicious-request-1" };
    await expect(actions.requestAction(tenant, { ...input, sourceRevisionId: "revision-1", reason: "reviewed" })).rejects.toThrow("OPERATIONS_CONTROL_ADMIN_ACCESS_DENIED");
    await expect(actions.requestAction(admin, input)).rejects.toThrow();
    expect(writes).toBe(0);
  });
});
