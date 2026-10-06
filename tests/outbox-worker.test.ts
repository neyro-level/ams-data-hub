import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ClaimedReliabilityEvent } from "../src/modules/platform-operations/application/ports/reliability-repository.ts";
import { drainOutboxWithDependencies, runOutboxWorkerWithDependencies } from "../src/modules/platform-operations/worker.ts";

function event(workerId: string): ClaimedReliabilityEvent {
  return {
    outboxEventId: "event-1",
    jobRunId: "run-1",
    workerId,
    leaseAcquiredAt: new Date().toISOString(),
    organizationId: null,
    topic: "platform.maintenance.requested",
    payload: {},
    attempt: 1,
    correlationId: randomUUID(),
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
  };
}

describe("outbox worker lifecycle", () => {
  it("defers an unsupported persisted topic even when the queued envelope claims maintenance", async () => {
    const queued = event("publisher"); const persisted = { ...queued, workerId: "worker-default", topic: "snapshot.build.request" };
    const complete = vi.fn(); const fail = vi.fn(); const defer = vi.fn();
    await expect(drainOutboxWithDependencies({ workerId: "worker-default", maxEvents: 1 }, {
      boss: { fetch: vi.fn(async () => [{ id: "queued-snapshot", data: { schemaVersion: 1, event: queued } }]), send: vi.fn(), complete: vi.fn() } as never,
      reliability: { claim: vi.fn(), takeOver: vi.fn(async () => persisted), complete, fail, defer }, heartbeat: vi.fn(),
    })).resolves.toEqual({ claimed: 1, completed: 0, failed: 0 });
    expect(defer).toHaveBeenCalledWith(persisted, "OUTBOX_EXECUTOR_RESERVED");
    expect(complete).not.toHaveBeenCalled(); expect(fail).not.toHaveBeenCalled();
  });
  it("defers a busy source dispatch without consuming its executor failure budget", async () => {
    const queued = event("publisher"); const persisted = { ...queued, workerId: "worker-default", topic: "ingestion.source.manual.request" };
    const defer = vi.fn(); const fail = vi.fn(); const complete = vi.fn();
    await drainOutboxWithDependencies({ workerId: "worker-default", maxEvents: 1 }, {
      boss: { fetch: vi.fn(async () => [{ id: "queued-manual", data: { schemaVersion: 1, event: queued } }]), send: vi.fn(), complete: vi.fn() } as never,
      reliability: { claim: vi.fn(), takeOver: vi.fn(async () => persisted), complete, fail, defer }, heartbeat: vi.fn(),
      topics: ["ingestion.source.manual.request"], handle: async () => ({ deferred: true, code: "SOURCE_JOB_QUEUE_BUSY" }),
    });
    expect(defer).toHaveBeenCalledWith(persisted, "SOURCE_JOB_QUEUE_BUSY"); expect(fail).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
  });
  it("claims only default-handler topics and leaves future-executor intents unclaimed", async () => {
    const claim = vi.fn(async () => null);
    await drainOutboxWithDependencies({ workerId: "worker-default" }, {
      boss: { fetch: vi.fn(async () => []), send: vi.fn(), complete: vi.fn() } as never,
      reliability: { claim } as never, heartbeat: vi.fn(async () => undefined),
    });
    expect(claim).toHaveBeenCalledWith("worker-default", undefined, ["platform.maintenance.requested"]);
  });

  it("finishes the active job before honoring shutdown", async () => {
    const controller = new AbortController();
    const queued = event("publisher");
    const active = { ...queued, workerId: "worker-1", leaseAcquiredAt: new Date().toISOString() };
    let releaseHandler!: () => void;
    const handlerBlocked = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const complete = vi.fn(async () => undefined);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce([{ id: "queue-job-1", data: { schemaVersion: 1, event: queued } }])
      .mockResolvedValue([]);

    const running = runOutboxWorkerWithDependencies(
      { workerId: "worker-1", maxEvents: 5, pollIntervalMs: 10, signal: controller.signal },
      {
        boss: {
          fetch,
          send: vi.fn(),
          complete: vi.fn(async () => undefined),
        } as never,
        reliability: {
          claim: vi.fn(async () => null),
          takeOver: vi.fn(async () => active),
          complete,
          fail: vi.fn(),
        } as never,
        heartbeat: vi.fn(async () => undefined),
        handle: async () => handlerBlocked,
      },
    );

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    controller.abort();
    expect(complete).not.toHaveBeenCalled();
    releaseHandler();

    await expect(running).resolves.toEqual({ claimed: 1, completed: 1, failed: 0 });
    expect(complete).toHaveBeenCalledWith(active);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("classifies a handler that exceeds the shutdown drain deadline", async () => {
    const controller = new AbortController();
    const queued = event("publisher");
    const active = { ...queued, workerId: "worker-2", leaseAcquiredAt: new Date().toISOString() };
    const fail = vi.fn(async () => ({ status: "pending" as const, availableAt: new Date().toISOString() }));
    const handle = vi.fn(async () => new Promise<void>(() => undefined));

    const running = runOutboxWorkerWithDependencies(
      {
        workerId: "worker-2",
        maxEvents: 1,
        pollIntervalMs: 10,
        shutdownDrainTimeoutMs: 10,
        signal: controller.signal,
      },
      {
        boss: {
          fetch: vi.fn().mockResolvedValueOnce([
            { id: "queue-job-2", data: { schemaVersion: 1, event: queued } },
          ]),
          send: vi.fn(),
          complete: vi.fn(async () => undefined),
        } as never,
        reliability: {
          claim: vi.fn(async () => null),
          takeOver: vi.fn(async () => active),
          complete: vi.fn(),
          fail,
        } as never,
        heartbeat: vi.fn(async () => undefined),
        handle,
      },
    );

    await vi.waitFor(() => expect(handle).toHaveBeenCalled());
    controller.abort();

    await expect(running).resolves.toEqual({ claimed: 1, completed: 0, failed: 1 });
    expect(fail).toHaveBeenCalledWith(active, "WORKER_SHUTDOWN_TIMEOUT", true, 5);
  });
});
