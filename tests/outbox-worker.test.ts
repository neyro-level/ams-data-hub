import { describe, expect, it, vi } from "vitest";
import type { JobWithMetadata, PgBoss } from "pg-boss";
import type { ClaimedReliabilityEvent } from "../src/modules/platform-operations/application/ports/reliability-repository.ts";
import type { OutboxDispatchJob } from "../src/modules/platform-operations/domain/pg-boss.ts";
import { drainOutboxWithDependencies } from "../src/modules/platform-operations/worker.ts";

const event: ClaimedReliabilityEvent = {
  outboxEventId: "event-1",
  jobRunId: "job-run-1",
  workerId: "worker-a",
  organizationId: null,
  topic: "test.topic",
  payload: { source: "event-payload" },
  attempt: 1,
  correlationId: "00000000-0000-4000-8000-000000000030",
  schemaVersion: 1,
  occurredAt: "2026-09-06T00:00:00.000Z",
};

function createReliability(claims: ClaimedReliabilityEvent[] = []) {
  return {
    claim: vi.fn(async () => claims.shift() ?? null),
    takeOver: vi.fn(async (claimed) => claimed),
    complete: vi.fn(async () => undefined),
    fail: vi.fn(async () => ({ status: "dead_letter" as const, availableAt: null })),
  };
}

function createBoss({
  jobs = [],
  sendResult = "queue-job-1",
}: {
  jobs?: JobWithMetadata<OutboxDispatchJob>[];
  sendResult?: string | null;
} = {}) {
  return {
    fetch: vi.fn(async () => (jobs.length > 0 ? [jobs.shift()!] : [])),
    send: vi.fn(async () => sendResult),
    complete: vi.fn(async () => undefined),
  };
}

describe("outbox worker dispatch boundary", () => {
  it("dispatches two claimed events without fetching after either send", async () => {
    const second = { ...event, outboxEventId: "event-2", jobRunId: "job-run-2" };
    const reliability = createReliability([event, second]);
    const boss = createBoss();

    const result = await drainOutboxWithDependencies(
      { workerId: "worker-a", maxEvents: 2 },
      { boss: boss as unknown as Pick<PgBoss, "send" | "fetch" | "complete">, reliability, heartbeat: vi.fn() },
    );

    expect(result).toEqual({ claimed: 2, completed: 0, failed: 0 });
    expect(boss.fetch).toHaveBeenCalledTimes(1);
    expect(boss.send).toHaveBeenNthCalledWith(
      1,
      "outbox.dispatch",
      { schemaVersion: 1, event },
      { singletonKey: "event-1" },
    );
    expect(boss.send).toHaveBeenNthCalledWith(
      2,
      "outbox.dispatch",
      { schemaVersion: 1, event: second },
      { singletonKey: "event-2" },
    );
    expect(reliability.fail).not.toHaveBeenCalled();
  });

  it("treats a null send result as an idempotent dispatch success", async () => {
    const reliability = createReliability([event]);
    const boss = createBoss({ sendResult: null });

    const result = await drainOutboxWithDependencies(
      { workerId: "worker-a", maxEvents: 1 },
      { boss: boss as unknown as Pick<PgBoss, "send" | "fetch" | "complete">, reliability, heartbeat: vi.fn() },
    );

    expect(result).toEqual({ claimed: 1, completed: 0, failed: 0 });
    expect(reliability.fail).not.toHaveBeenCalled();
  });

  it("processes only the event carried by job.data.event", async () => {
    const queuedEvent = { ...event, payload: { source: "job.data.event" } };
    const job = {
      id: "queue-job-1",
      data: { schemaVersion: 1, event: queuedEvent },
    } as unknown as JobWithMetadata<OutboxDispatchJob>;
    const reliability = createReliability();
    reliability.takeOver.mockResolvedValue(queuedEvent);
    const boss = createBoss({ jobs: [job] });
    const handle = vi.fn(async () => undefined);

    const result = await drainOutboxWithDependencies(
      { workerId: "worker-a", maxEvents: 1 },
      {
        boss: boss as unknown as Pick<PgBoss, "send" | "fetch" | "complete">,
        reliability,
        heartbeat: vi.fn(),
        handle,
      },
    );

    expect(result).toEqual({ claimed: 1, completed: 1, failed: 0 });
    expect(handle).toHaveBeenCalledWith(queuedEvent);
    expect(reliability.complete).toHaveBeenCalledWith(queuedEvent);
  });
});
