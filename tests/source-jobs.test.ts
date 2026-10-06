import { describe, expect, it, vi } from "vitest";
import type { ProjectJobPrincipal } from "../src/platform/authorization/principal.ts";
import type { DatabaseTransaction } from "../src/platform/database/transaction.ts";
import {
  createSourceJobs,
  drainSourceJobQueue,
  PgBossSourceJobQueue,
  PrismaSourceJobRepository,
  SOURCE_IMPORT_QUEUE,
  SOURCE_SCHEDULE_CRON,
  sourceImportJobSchema,
  type SourceJobExecutionContext,
  type SourceJobRecord,
  type SourceScheduleBoss,
} from "../src/modules/ingestion-core/worker.ts";

const scheduled: SourceJobRecord = {
  organizationId: "org-1",
  projectId: "project-1",
  sourceId: "source-1",
  enabled: true,
  schedulePolicy: { mode: "SCHEDULED", cadenceMinutes: 60 },
  lastAttemptAt: new Date("2026-10-05T00:00:00.000Z"),
  updatedAt: new Date("2026-10-04T00:00:00.000Z"),
};

function context(overrides: Partial<SourceJobExecutionContext> = {}): SourceJobExecutionContext {
  return { ...scheduled, serviceState: "ACTIVE", ...overrides };
}

describe("source jobs", () => {
  it("settles only terminal native manual failures", async () => {
    const fail = vi.fn();
    const jobs = createSourceJobs({ repository: { listSchedulingSources: vi.fn(), loadExecutionContext: vi.fn() },
      queue: { reconcileSchedules: vi.fn() }, runImport: vi.fn(), manualRequests: { load: vi.fn(), fail } });
    const job = { schemaVersion: 1, organizationId: "org-1", projectId: "project-1", sourceId: "source-1", trigger: "MANUAL", manualRequestId: "request-1" } as const;
    await jobs.onFailure(job, false); expect(fail).not.toHaveBeenCalled();
    await jobs.onFailure(job, true);
    expect(fail).toHaveBeenCalledWith(expect.objectContaining({ kind: "project-job", organizationId: "org-1", projectId: "project-1" }), "source-1", "request-1");
  });
  it.each(["COMPLETED", "FAILED"] as const)("does not repeat intake for a settled %s manual request", async (status) => {
    const runImport = vi.fn(); const loadExecutionContext = vi.fn();
    const jobs = createSourceJobs({ repository: { listSchedulingSources: vi.fn(), loadExecutionContext },
      queue: { reconcileSchedules: vi.fn() }, runImport, manualRequests: { load: vi.fn(async () => ({ status })), fail: vi.fn() } });
    await expect(jobs.run({ schemaVersion: 1, organizationId: "org-1", projectId: "project-1", sourceId: "source-1",
      trigger: "MANUAL", manualRequestId: "request-1" })).resolves.toEqual({ status: "SKIPPED", reason: "MANUAL_REQUEST_SETTLED" });
    expect(runImport).not.toHaveBeenCalled(); expect(loadExecutionContext).not.toHaveBeenCalled();
  });
  it("rejects request overrides on scheduled jobs", () => {
    expect(sourceImportJobSchema.safeParse({ schemaVersion: 1, organizationId: "org-1", projectId: "project-1", sourceId: "source-1",
      trigger: "SCHEDULED", manualRequestId: "request-1" }).success).toBe(false);
  });
  it("bounds the global scheduling query without reading tenant Project relations", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = new PrismaSourceJobRepository({ source: { findMany } } as unknown as DatabaseTransaction);
    await expect(repository.listSchedulingSources()).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10_001, orderBy: { id: "asc" } }));
    expect(findMany.mock.calls[0]![0].select).not.toHaveProperty("project");
    findMany.mockResolvedValue(Array.from({ length: 10_001 }, () => ({})));
    await expect(repository.listSchedulingSources()).rejects.toThrow("SOURCE_SCHEDULE_REGISTRY_LIMIT");
  });
  it("rejects duplicate or oversized schedule registries before queue mutation", async () => {
    const boss = { createQueue: vi.fn(), schedule: vi.fn(), unschedule: vi.fn(), getSchedules: vi.fn() } as unknown as SourceScheduleBoss;
    const queue = new PgBossSourceJobQueue(boss);
    await expect(queue.reconcileSchedules([scheduled, scheduled])).rejects.toThrow("SOURCE_SCHEDULE_REGISTRY_INVALID");
    await expect(queue.reconcileSchedules(Array.from({ length: 10_001 }, (_, index) => ({ ...scheduled, sourceId: `source-${index}` }))))
      .rejects.toThrow("SOURCE_SCHEDULE_REGISTRY_INVALID");
    expect(boss.createQueue).not.toHaveBeenCalled(); expect(boss.unschedule).not.toHaveBeenCalled();
  });
  it("uses an exclusive pg-boss queue and a stable singleton per source", async () => {
    const boss = {
      createQueue: vi.fn().mockResolvedValue(undefined),
      schedule: vi.fn().mockResolvedValue(undefined),
      unschedule: vi.fn().mockResolvedValue(undefined),
      getSchedules: vi.fn().mockResolvedValue([{ key: "deleted" }, { key: "source-1" }]),
    } as unknown as SourceScheduleBoss;
    const queue = new PgBossSourceJobQueue(boss);

    await queue.reconcileSchedules([
      scheduled,
      { ...scheduled, sourceId: "manual", schedulePolicy: { mode: "MANUAL_ONLY" } },
      { ...scheduled, sourceId: "disabled", enabled: false },
    ]);

    expect(boss.createQueue).toHaveBeenCalledWith(
      SOURCE_IMPORT_QUEUE,
      expect.objectContaining({ policy: "exclusive" }),
    );
    expect(boss.schedule).toHaveBeenCalledWith(
      SOURCE_IMPORT_QUEUE,
      SOURCE_SCHEDULE_CRON,
      expect.objectContaining({ sourceId: "source-1", trigger: "SCHEDULED" }),
      expect.objectContaining({ key: "source-1", singletonKey: "source-1", tz: "UTC" }),
    );
    expect(boss.unschedule).toHaveBeenCalledWith(SOURCE_IMPORT_QUEUE, "manual");
    expect(boss.unschedule).toHaveBeenCalledWith(SOURCE_IMPORT_QUEUE, "disabled");
    expect(boss.unschedule).toHaveBeenCalledWith(SOURCE_IMPORT_QUEUE, "deleted");
    expect(boss.unschedule).not.toHaveBeenCalledWith(SOURCE_IMPORT_QUEUE, "source-1");
  });

  it("blocks a suspended project before import", async () => {
    const runImport = vi.fn();
    let observedPrincipal: ProjectJobPrincipal | null = null;
    const jobs = createSourceJobs({
      repository: {
        listSchedulingSources: vi.fn().mockResolvedValue([]),
        loadExecutionContext: vi.fn(async (principal) => {
          observedPrincipal = principal;
          return context({ serviceState: "SUSPENDED" });
        }),
      },
      queue: { reconcileSchedules: vi.fn() },
      runImport,
      now: () => new Date("2026-10-05T02:00:00.000Z"),
    });

    await expect(jobs.run({
      schemaVersion: 1,
      organizationId: "org-1",
      projectId: "project-1",
      sourceId: "source-1",
      trigger: "SCHEDULED",
    })).resolves.toEqual({ status: "BLOCKED", reason: "PROJECT_SUSPENDED" });
    expect(observedPrincipal).toMatchObject({
      kind: "project-job",
      organizationId: "org-1",
      projectId: "project-1",
    });
    expect(runImport).not.toHaveBeenCalled();
  });

  it("runs due work under a project-job principal and skips early schedule ticks", async () => {
    const runImport = vi.fn().mockResolvedValue({ state: "GOOD", sourceId: "source-1", revisionId: "synthetic-revision",
      sequence: 1, rawArtifactHash: "a".repeat(64), normalizedContentHash: "b".repeat(64), snapshotTriggered: true });
    const source = context();
    const jobs = createSourceJobs({
      repository: {
        listSchedulingSources: vi.fn().mockResolvedValue([source]),
        loadExecutionContext: vi.fn().mockResolvedValue(source),
      },
      queue: { reconcileSchedules: vi.fn() },
      runImport,
      now: () => new Date("2026-10-05T00:30:00.000Z"),
    });
    const payload = {
      schemaVersion: 1 as const,
      organizationId: "org-1",
      projectId: "project-1",
      sourceId: "source-1",
      trigger: "SCHEDULED" as const,
    };

    await expect(jobs.run(payload)).resolves.toEqual({ status: "SKIPPED", reason: "NOT_DUE" });
    expect(runImport).not.toHaveBeenCalled();

    const dueJobs = createSourceJobs({
      repository: {
        listSchedulingSources: vi.fn().mockResolvedValue([source]),
        loadExecutionContext: vi.fn().mockResolvedValue(source),
      },
      queue: { reconcileSchedules: vi.fn() },
      runImport,
      now: () => new Date("2026-10-05T01:00:00.000Z"),
    });
    await expect(dueJobs.run(payload)).resolves.toEqual({ status: "COMPLETED" });
    expect(runImport).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "project-job", projectId: "project-1" }),
      { organizationId: "org-1", projectId: "project-1", sourceId: "source-1" },
      payload,
    );
  });

  it("settles pg-boss jobs and retries unexpected handler failures", async () => {
    const job = {
      id: "job-1",
      data: {
        schemaVersion: 1,
        organizationId: "org-1",
        projectId: "project-1",
        sourceId: "source-1",
        trigger: "SCHEDULED",
      },
    };
    const boss = {
      fetch: vi.fn().mockResolvedValue([job]),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
    };
    const handler = { run: vi.fn().mockResolvedValue({ status: "BLOCKED", reason: "PROJECT_SUSPENDED" }) };

    await expect(drainSourceJobQueue(boss as never, handler, 1)).resolves.toEqual({
      fetched: 1,
      completed: 0,
      blocked: 1,
      skipped: 0,
      failed: 0,
      deferred: 0,
    });
    expect(boss.complete).toHaveBeenCalledWith(
      SOURCE_IMPORT_QUEUE,
      "job-1",
      { status: "BLOCKED", reason: "PROJECT_SUSPENDED" },
    );

    boss.fetch.mockResolvedValueOnce([job]);
    handler.run.mockRejectedValueOnce(new Error("IMPORT_PIPELINE_FAILED"));
    await expect(drainSourceJobQueue(boss as never, handler, 1)).resolves.toMatchObject({ failed: 1 });
    expect(boss.fail).toHaveBeenCalledWith(
      SOURCE_IMPORT_QUEUE,
      "job-1",
      { status: "FAILED", code: "IMPORT_PIPELINE_FAILED" },
    );
  });

  it.each([{ state: "FAILED", sourceId: "source-1", failedStage: "PARSE", code: "YRL_XML_MALFORMED" },
    undefined, { state: "GOOD", sourceId: "other-source" }])("never completes failed, absent or cross-source results %j", async (result) => {
    const jobs = createSourceJobs({ repository: { listSchedulingSources: vi.fn(), loadExecutionContext: vi.fn(async () => context()) },
      queue: { reconcileSchedules: vi.fn() }, runImport: vi.fn().mockResolvedValue(result) });
    const boss = { fetch: vi.fn(async () => [{ id: "synthetic-failed", data: { schemaVersion: 1,
      organizationId: "org-1", projectId: "project-1", sourceId: "source-1", trigger: "MANUAL" } }]),
      complete: vi.fn(), fail: vi.fn() };
    expect(await drainSourceJobQueue(boss as never, jobs, 1)).toMatchObject({ failed: 1, completed: 0 });
    expect(boss.complete).not.toHaveBeenCalled();
    expect(boss.fail).toHaveBeenCalledWith(SOURCE_IMPORT_QUEUE, "synthetic-failed", { status: "FAILED", code: "SOURCE_IMPORT_FAILED" });
  });
  it("bounds IDs and rejects endpoint overrides in queue payloads", () => {
    const payload = { schemaVersion: 1, organizationId: "org-1", projectId: "project-1", sourceId: "source-1", trigger: "MANUAL" };
    for (const patch of [{ sourceId: "x".repeat(129) }, { sourceId: "https://private.invalid" },
      { endpointUrl: "https://private.invalid" }, { organizationId: "x".repeat(129) }, { projectId: "x".repeat(129) }]) {
      expect(sourceImportJobSchema.safeParse({ ...payload, ...patch }).success).toBe(false);
    }
  });
  it.each([
    ["SOURCE_EXECUTION_BUSY", "SOURCE_EXECUTION_BUSY"], ["SOURCE_EXECUTION_ABORTED", "WORKER_SHUTDOWN"],
  ] as const)("defers %s even at the terminal native retry without failing the durable manual request", async (code, reason) => {
    const payload = { schemaVersion: 1 as const, organizationId: "org-1", projectId: "project-1", sourceId: "source-1", trigger: "MANUAL" as const,
      manualRequestId: "request" };
    const manual = { load: vi.fn(async () => ({ status: "REQUESTED" as const })), fail: vi.fn() };
    const jobs = createSourceJobs({ repository: { listSchedulingSources: vi.fn(), loadExecutionContext: vi.fn(async () => context()) },
      queue: { reconcileSchedules: vi.fn() }, manualRequests: manual,
      runImport: vi.fn(async () => ({ state: "FAILED" as const, sourceId: "source-1", failedStage: "SAFE_INTAKE" as const, code })) });
    const job = { id: "busy", retryCount: 3, retryLimit: 3, data: payload };
    const boss = { fetch: vi.fn(async () => [job]), complete: vi.fn(), fail: vi.fn() };
    const defer = vi.fn();
    expect(await drainSourceJobQueue(boss as never, jobs, 1, defer)).toMatchObject({ deferred: 1, completed: 0, failed: 0 });
    expect(defer).toHaveBeenCalledWith(job, reason); expect(boss.fail).not.toHaveBeenCalled(); expect(manual.fail).not.toHaveBeenCalled();
    defer.mockRejectedValueOnce(new Error("private dispatch failure"));
    await expect(drainSourceJobQueue(boss as never, jobs, 1, defer)).rejects.toThrow("SOURCE_JOB_DEFERRAL_FAILED");
    expect(boss.fail).not.toHaveBeenCalled(); expect(manual.fail).not.toHaveBeenCalled();
  });
  it("does not fetch after shutdown and defers a job fetched simultaneously without invoking its handler", async () => {
    const controller = new AbortController();
    const job = { id: "shutdown-race", data: { schemaVersion: 1, organizationId: "org-1", projectId: "project-1", sourceId: "source-1", trigger: "MANUAL" } };
    const boss = { fetch: vi.fn(async () => { controller.abort(); return [job]; }), complete: vi.fn(), fail: vi.fn() };
    const handler = { run: vi.fn(), onFailure: vi.fn() }; const defer = vi.fn();
    expect(await drainSourceJobQueue(boss as never, handler, 1, defer, controller.signal)).toMatchObject({ fetched: 1, deferred: 1, failed: 0 });
    expect(defer).toHaveBeenCalledWith(job, "WORKER_SHUTDOWN"); expect(handler.run).not.toHaveBeenCalled();
    expect(handler.onFailure).not.toHaveBeenCalled(); expect(boss.complete).not.toHaveBeenCalled(); expect(boss.fail).not.toHaveBeenCalled();
    expect(await drainSourceJobQueue(boss as never, handler, 1, defer, controller.signal)).toMatchObject({ fetched: 0 });
    expect(boss.fetch).toHaveBeenCalledOnce();
  });
  it("acknowledges already committed GOOD even if shutdown arrives immediately before native acknowledgement", async () => {
    const controller = new AbortController();
    const job = { id: "shutdown-after-good", data: { schemaVersion: 1, organizationId: "org-1", projectId: "project-1", sourceId: "source-1", trigger: "MANUAL" } };
    const boss = { fetch: vi.fn(async () => [job]), complete: vi.fn(), fail: vi.fn() }; const defer = vi.fn();
    const handler = { run: vi.fn(async () => { controller.abort(); return { status: "COMPLETED" as const }; }) };
    expect(await drainSourceJobQueue(boss as never, handler, 1, defer, controller.signal)).toMatchObject({ completed: 1, deferred: 0 });
    expect(boss.complete).toHaveBeenCalledWith(SOURCE_IMPORT_QUEUE, job.id, { status: "COMPLETED" }); expect(defer).not.toHaveBeenCalled();
  });
});
