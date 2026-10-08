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
  it("reserves BUILD when its concrete capability is absent", async () => {
    const before = executor.mock.calls.length;
    await expect(handleOperationalOutboxEvent({ ...event, topic: OPERATIONAL_ACTION_TOPICS.SNAPSHOT_BUILD })).rejects.toMatchObject({
      code: "OPERATIONS_CONTROL_EXECUTOR_UNSUPPORTED", retryable: false,
    });
    expect(executor.mock.calls.length).toBe(before);
  });
  it("reserves PUBLISH without its capability and dispatches enabled public-only adapter", async () => {
    const publishEvent = { ...event, topic: OPERATIONAL_ACTION_TOPICS.SNAPSHOT_PUBLISH };
    const before = executor.mock.calls.length;
    await expect(handleOperationalOutboxEvent(publishEvent)).rejects.toMatchObject({ code: "OPERATIONS_CONTROL_EXECUTOR_UNSUPPORTED", retryable: false });
    const publish = vi.fn(async () => ({ action: "SNAPSHOT_PUBLISH" as const, buildInputId: "synthetic-input", deliveryRunId: "synthetic-run",
      manifestSha256: "a".repeat(64), publishSequence: 1 }));
    const signal = new AbortController().signal;
    await expect(handleOperationalOutboxEvent(publishEvent, signal, undefined, publish)).resolves.toBeUndefined();
    expect(publish).toHaveBeenCalledWith(publishEvent, signal); expect(executor.mock.calls.length).toBe(before);
    publish.mockRejectedValueOnce(new Error("SNAPSHOT_PUBLICATION_PROJECT_BLOCKED"));
    await expect(handleOperationalOutboxEvent(publishEvent, signal, undefined, publish)).resolves.toEqual({ deferred: true, code: "OPERATIONS_CONTROL_EXECUTION_DEFERRED" });
    publish.mockRejectedValueOnce(new Error("Synthetic private GET diagnostic"));
    await expect(handleOperationalOutboxEvent(publishEvent, signal, undefined, publish)).rejects.toMatchObject({ message: "OPERATIONS_CONTROL_EXECUTION_FAILED", retryable: true });
  });
  it("dispatches only the enabled operational BUILD adapter with its owned signal", async () => {
    const buildEvent = { ...event, topic: OPERATIONAL_ACTION_TOPICS.SNAPSHOT_BUILD };
    const build = vi.fn(async () => ({ action: "SNAPSHOT_BUILD" as const, buildInputId: "synthetic-input",
      inputHash: "a".repeat(64), manifestSha256: "b".repeat(64), publishSequence: 1 }));
    const signal = new AbortController().signal; const before = executor.mock.calls.length;
    await expect(handleOperationalOutboxEvent(buildEvent, signal, build)).resolves.toBeUndefined();
    expect(build).toHaveBeenCalledWith(buildEvent, signal); expect(executor.mock.calls.length).toBe(before);
    build.mockRejectedValueOnce(new Error("SNAPSHOT_INPUT_JOBS_FROZEN"));
    await expect(handleOperationalOutboxEvent(buildEvent, signal, build)).resolves.toEqual({
      deferred: true, code: "OPERATIONS_CONTROL_EXECUTION_DEFERRED" });
    build.mockRejectedValueOnce(Object.assign(new Error("Synthetic private signing diagnostic"), { code: "Synthetic private code" }));
    await expect(handleOperationalOutboxEvent(buildEvent, signal, build)).rejects.toMatchObject({
      message: "OPERATIONS_CONTROL_EXECUTION_FAILED", code: "OPERATIONS_CONTROL_EXECUTION_FAILED", retryable: true });
  });
  it("reserves ROLLBACK without its capability and forwards only the owned enabled adapter", async () => {
    const rollbackEvent = { ...event, topic: OPERATIONAL_ACTION_TOPICS.SNAPSHOT_ROLLBACK };
    await expect(handleOperationalOutboxEvent(rollbackEvent)).rejects.toMatchObject({ code: "OPERATIONS_CONTROL_EXECUTOR_UNSUPPORTED", retryable: false });
    const rollback = vi.fn(async () => ({ action: "SNAPSHOT_ROLLBACK" as const, sourcePublishSequence: 1,
      sourceDeliveryRunId: "synthetic-source", deliveryRunId: "synthetic-new", publishSequence: 2, manifestSha256: "a".repeat(64) }));
    const signal = new AbortController().signal; const before = executor.mock.calls.length;
    await expect(handleOperationalOutboxEvent(rollbackEvent, signal, undefined, undefined, rollback)).resolves.toBeUndefined();
    expect(rollback).toHaveBeenCalledWith(rollbackEvent, signal); expect(executor.mock.calls.length).toBe(before);
    rollback.mockRejectedValueOnce(new Error("SNAPSHOT_PUBLICATION_PROJECT_BLOCKED"));
    await expect(handleOperationalOutboxEvent(rollbackEvent, signal, undefined, undefined, rollback)).resolves.toEqual({ deferred: true, code: "OPERATIONS_CONTROL_EXECUTION_DEFERRED" });
    rollback.mockRejectedValueOnce(new Error("Synthetic private rollback diagnostic"));
    await expect(handleOperationalOutboxEvent(rollbackEvent, signal, undefined, undefined, rollback)).rejects.toMatchObject({ message: "OPERATIONS_CONTROL_EXECUTION_FAILED", retryable: true });
  });
});
