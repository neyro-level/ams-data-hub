import { describe, expect, it, vi } from "vitest";
import { Prisma } from "../src/generated/prisma/client.ts";
import { createProjectJobPrincipal } from "../src/platform/authorization/principal-factories.ts";

const state = vi.hoisted(() => ({ failures: [] as unknown[], attempts: 0 }));
vi.mock("../src/platform/database/transaction.ts", () => {
  const transaction = {
    dataSafetyState: { findUnique: async () => ({ jobsFrozen: false }) },
    project: { findFirst: async () => ({ status: "ACTIVE", serviceState: "ACTIVE" }) },
  };
  return {
    createDatabaseAuthorizationContext: () => ({}),
    runInAuthorizedDatabaseTransaction: async (_context: unknown,
      execute: (tx: typeof transaction) => Promise<unknown>, options?: { isolationLevel?: string }) => {
      if (options?.isolationLevel === "RepeatableRead") {
        state.attempts++;
        if (state.failures.length) throw state.failures.shift();
      }
      return execute(transaction);
    },
  };
});
vi.mock("../src/modules/snapshot-delivery/infrastructure/prisma-snapshot-input-repository.ts", () => ({
  PrismaSnapshotInputRepository: class { lockProject = vi.fn(async () => {}); },
}));
import { runInSnapshotInputTransaction } from "../src/modules/snapshot-delivery/infrastructure/snapshot-input-transaction.ts";

const job = createProjectJobPrincipal({ organizationId: "synthetic-org", projectId: "synthetic-project", jobName: "snapshot-input" });
const known = (code: string, meta?: Record<string, unknown>) => new Prisma.PrismaClientKnownRequestError("Synthetic failure", {
  code, clientVersion: "synthetic", ...(meta ? { meta } : {}),
});
describe("bounded snapshot whole-transaction retry", () => {
  it.each([
    known("P2034"), known("P2010", { code: "40001" }),
    known("P2010", { driverAdapterError: { cause: { originalCode: "40001", kind: "TransactionWriteConflict" } } }),
    new Error("SNAPSHOT_SEQUENCE_CONFLICT"),
  ])("retries only supported transaction conflicts", async (failure) => {
    state.attempts = 0; state.failures = [failure];
    expect(await runInSnapshotInputTransaction(job, async () => "complete")).toBe("complete");
    expect(state.attempts).toBe(2);
  });
  it.each([
    known("P2002"), known("P2010", { code: "23505" }),
    known("P2010", { driverAdapterError: { cause: { originalCode: "23505", kind: "UniqueConstraintViolation" } } }),
    known("P2010", { driverAdapterError: { cause: { originalCode: "40001", kind: "Unknown" } } }),
    known("P2010", { driverAdapterError: null }), new Error("Synthetic non-retryable failure"),
  ])("propagates other failures without swallowing them", async (failure) => {
    state.attempts = 0; state.failures = [failure];
    await expect(runInSnapshotInputTransaction(job, async () => "unexpected")).rejects.toBe(failure);
    expect(state.attempts).toBe(1);
  });
  it("retains the five-attempt limit", async () => {
    state.attempts = 0; state.failures = Array.from({ length: 5 }, () => known("P2034"));
    await expect(runInSnapshotInputTransaction(job, async () => "unexpected")).rejects.toThrow("SNAPSHOT_INPUT_RETRY_EXHAUSTED");
    expect(state.attempts).toBe(5);
  });
});
