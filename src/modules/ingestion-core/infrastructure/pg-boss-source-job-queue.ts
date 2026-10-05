import type { PgBoss } from "pg-boss";
import type { SourceJobQueue } from "../application/ports/source-job-queue.ts";
import type { SourceJobRecord } from "../application/ports/source-job-repository.ts";
import {
  SOURCE_IMPORT_JOB_SCHEMA_VERSION,
  SOURCE_IMPORT_QUEUE,
  SOURCE_SCHEDULE_CRON,
  sourceJobKey,
  type SourceImportJob,
} from "../domain/source-jobs.ts";
import { isSourceEligibleForAutomaticRun } from "../domain/source-schedule.ts";

export type SourceScheduleBoss = Pick<PgBoss, "createQueue" | "schedule" | "unschedule">;

export class PgBossSourceJobQueue implements SourceJobQueue {
  constructor(private readonly boss: SourceScheduleBoss) {}

  async reconcileSchedules(sources: readonly SourceJobRecord[]): Promise<void> {
    await this.boss.createQueue(SOURCE_IMPORT_QUEUE, {
      policy: "exclusive",
      retryLimit: 3,
      retryDelay: 30,
      retryBackoff: true,
      retryDelayMax: 900,
      expireInSeconds: 3_600,
      deleteAfterSeconds: 86_400,
    });

    for (const source of sources) {
      const key = sourceJobKey(source.sourceId);
      if (!isSourceEligibleForAutomaticRun(source)) {
        await this.boss.unschedule(SOURCE_IMPORT_QUEUE, key);
        continue;
      }
      const payload: SourceImportJob = {
        schemaVersion: SOURCE_IMPORT_JOB_SCHEMA_VERSION,
        organizationId: source.organizationId,
        projectId: source.projectId,
        sourceId: source.sourceId,
        trigger: "SCHEDULED",
      };
      await this.boss.schedule(SOURCE_IMPORT_QUEUE, SOURCE_SCHEDULE_CRON, payload, {
        key,
        singletonKey: key,
        tz: "UTC",
      });
    }
  }
}
