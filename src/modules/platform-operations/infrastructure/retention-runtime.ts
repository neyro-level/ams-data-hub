import { Prisma, RetentionRunStatus } from "../../../generated/prisma/client.ts";
import { runInSystemJobDatabaseTransaction } from "../../../platform/database/transaction.ts";

const PROCESSED_RETENTION_DAYS = 14;
const DEAD_LETTER_RETENTION_DAYS = 30;

export interface RunRetentionResult {
  retentionRunId: string;
  deletedOutboxEvents: number;
  deletedJobRuns: number;
}

function cutoffDate(now: Date, days: number) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export async function runReliabilityRetention(now = new Date()): Promise<RunRetentionResult> {
  const processedCutoff = cutoffDate(now, PROCESSED_RETENTION_DAYS);
  const deadLetterCutoff = cutoffDate(now, DEAD_LETTER_RETENTION_DAYS);

  return runInSystemJobDatabaseTransaction({
    jobName: "outbox-retention",
    correlationId: `outbox-retention-${now.getTime()}`,
  }, async (transaction) => {
    const retentionRun = await transaction.retentionRun.create({
      data: {
        status: RetentionRunStatus.RUNNING,
        startedAt: now,
      },
      select: { id: true },
    });

    const outboxEvents = await transaction.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id" FROM "OutboxEvent"
      WHERE (("status" = 'PROCESSED' AND "processedAt" < ${processedCutoff})
        OR ("status" = 'DEAD_LETTER' AND "occurredAt" < ${deadLetterCutoff}))
        AND operational_outbox_retention_allowed("id")`);
    const outboxEventIds = outboxEvents.map((event) => event.id);
    const deletedJobRuns = outboxEventIds.length
      ? await transaction.jobRun.count({ where: { outboxEventId: { in: outboxEventIds } } })
      : 0;
    const deletedOutboxEvents = outboxEventIds.length
      ? (await transaction.outboxEvent.deleteMany({ where: { id: { in: outboxEventIds } } })).count
      : 0;

    await transaction.retentionRun.update({
      where: { id: retentionRun.id },
      data: {
        status: RetentionRunStatus.SUCCESS,
        finishedAt: now,
        deletedOutboxEvents,
        deletedJobRuns,
      },
    });

    return {
      retentionRunId: retentionRun.id,
      deletedOutboxEvents,
      deletedJobRuns,
    };
  });
}
