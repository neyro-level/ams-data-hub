import { describe, expect, it, vi } from "vitest";
import type { ProjectJobPrincipal } from "../src/platform/authorization/principal.ts";
import {
  createSourceJobs,
  drainSourceJobQueue,
  PgBossSourceJobQueue,
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
  it("uses an exclusive pg-boss queue and a stable singleton per source", async () => {
    const boss = {
      createQueue: vi.fn().mockResolvedValue(undefined),
      schedule: vi.fn().mockResolvedValue(undefined),
      unschedule: vi.fn().mockResolvedValue(undefined),
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
});
