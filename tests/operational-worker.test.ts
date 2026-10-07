import { describe, expect, it, vi } from "vitest";
const executor = vi.hoisted(() => vi.fn());
vi.mock("../src/modules/operations-control/infrastructure/suspicious-rejection-executor.ts", () => ({ executeSuspiciousRejection: executor }));
import { handleOperationalOutboxEvent, OPERATIONAL_EXECUTOR_TOPICS } from "../src/modules/operations-control/worker.ts";
import { OPERATIONAL_ACTION_TOPICS } from "../src/modules/operations-control/index.ts";
import type { ClaimedReliabilityEvent } from "../src/modules/platform-operations/index.ts";

const event: ClaimedReliabilityEvent = { schemaVersion: 1, outboxEventId: "synthetic-event", jobRunId: "synthetic-job",
  organizationId: "synthetic-org", topic: OPERATIONAL_ACTION_TOPICS.SUSPICIOUS_REJECT, payload: {}, correlationId: "synthetic-correlation",
  attempt: 1, workerId: "synthetic-worker", leaseAcquiredAt: "2026-10-07T00:00:00.000Z", occurredAt: "2026-10-07T00:00:00.000Z" };

describe("finite operational queue adapter", () => {
  it("registers only the real rejection adapter and forwards the owned signal", async () => {
    expect(OPERATIONAL_EXECUTOR_TOPICS).toEqual([OPERATIONAL_ACTION_TOPICS.SUSPICIOUS_REJECT]);
    const signal = new AbortController().signal; executor.mockResolvedValueOnce({ action: "SUSPICIOUS_REJECT" });
    await expect(handleOperationalOutboxEvent(event, signal)).resolves.toBeUndefined();
    expect(executor).toHaveBeenLastCalledWith(event, signal);
  });
  it.each(["DATA_SAFETY_JOBS_FROZEN", "SOURCE_OPERATION_REVIEW_BLOCKED", "OPERATIONS_CONTROL_EXECUTION_CANCELLED", "OUTBOX_OPERATION_LEASE_LOST"])(
    "defers %s without declaring terminal request failure", async (code) => {
      executor.mockRejectedValueOnce(new Error(code));
      await expect(handleOperationalOutboxEvent(event)).resolves.toEqual({ deferred: true, code: "OPERATIONS_CONTROL_EXECUTION_DEFERRED" });
    });
  it.each(["SOURCE_REVISION_SAFETY_INVALID", "OPERATIONS_CONTROL_REFERENCE_INVALID"])("normalizes deterministic %s", async (code) => {
    executor.mockRejectedValueOnce(new Error(code));
    await expect(handleOperationalOutboxEvent(event)).rejects.toMatchObject({ message: "OPERATIONS_CONTROL_EXECUTION_FAILED",
      code: "OPERATIONS_CONTROL_EXECUTION_FAILED", retryable: false });
  });
  it("normalizes unexpected private diagnostic text and arbitrary codes into bounded retries", async () => {
    executor.mockRejectedValueOnce(Object.assign(new Error("Synthetic private diagnostic"), { code: "Synthetic private code" }));
    await expect(handleOperationalOutboxEvent(event)).rejects.toMatchObject({ message: "OPERATIONS_CONTROL_EXECUTION_FAILED",
      code: "OPERATIONS_CONTROL_EXECUTION_FAILED", retryable: true });
  });
  it("does not pretend the other five reserved adapters are implemented", async () => {
    const before = executor.mock.calls.length;
    await expect(handleOperationalOutboxEvent({ ...event, topic: OPERATIONAL_ACTION_TOPICS.SNAPSHOT_BUILD })).rejects.toMatchObject({
      code: "OPERATIONS_CONTROL_EXECUTOR_UNSUPPORTED", retryable: false,
    });
    expect(executor.mock.calls.length).toBe(before);
  });
});
