import { describe, expect, it, vi } from "vitest";
import type { PrincipalContext } from "../src/platform/authorization/principal.ts";
import type { DatabaseTransaction } from "../src/platform/database/transaction.ts";
import { assertMutatingJobsAllowed, createDataSafetyService, type DataSafetyRepository, type DataSafetySnapshot } from "../src/modules/platform-operations/application/data-safety-service.ts";

const admin: PrincipalContext = { kind: "platform-admin", userId: "admin-1", correlationId: "corr-1" };
const member: PrincipalContext = { kind: "tenant-user", userId: "user-1", organizationId: "org-1", membershipId: "member-1", role: "ORG_ADMIN", projectIds: ["project-1"], correlationId: "corr-2" };

function harness() {
  let state: DataSafetySnapshot = { jobsFrozen: false, frozenAt: null, reconciledAt: null };
  const repository: DataSafetyRepository = {
    freeze: vi.fn(async (_reason, now) => (state = { jobsFrozen: true, frozenAt: now, reconciledAt: null })),
    markReconciled: vi.fn(async (now) => (state = { ...state, reconciledAt: now })),
    unfreeze: vi.fn(async () => (state = { ...state, jobsFrozen: false })),
    read: vi.fn(async () => state),
  };
  const service = createDataSafetyService({
    createRepository: () => repository,
    now: () => new Date("2026-10-04T20:00:00Z"),
    runInTransaction: async (_principal, execute) => execute({} as DatabaseTransaction),
  });
  return { repository, service };
}

describe("data safety state", () => {
  it("keeps jobs frozen until a clean reconcile completes", async () => {
    const { repository, service } = harness();
    await service.freezeMutatingJobs(admin, { reason: "restore" });
    await expect(assertMutatingJobsAllowed(repository)).rejects.toThrow("DATA_SAFETY_JOBS_FROZEN");
    await expect(service.unfreezeMutatingJobs(admin, {})).rejects.toThrow("DATA_SAFETY_RECONCILE_REQUIRED");
    await service.reconcileAfterRestore(admin, { publicUrlIdConflicts: 0, uidConflicts: 0, publishSequenceConflicts: 0 });
    await service.unfreezeMutatingJobs(admin, {});
    await expect(assertMutatingJobsAllowed(repository)).resolves.toBeUndefined();
  });

  it("rejects conflicts and non-admin control", async () => {
    const { service } = harness();
    await expect(service.freezeMutatingJobs(member, { reason: "restore" })).rejects.toThrow("DATA_SAFETY_ADMIN_REQUIRED");
    await expect(service.reconcileAfterRestore(admin, { publicUrlIdConflicts: 1, uidConflicts: 0, publishSequenceConflicts: 0 })).rejects.toEqual(expect.objectContaining({ code: "DATA_SAFETY_RECONCILE_FAILED" }));
  });
});
