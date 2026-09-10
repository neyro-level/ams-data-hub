import { RetentionRunStatus } from "../../../generated/prisma/client.ts";
import { getPrismaClient } from "../../../platform/database/prisma/client.ts";

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
  const prisma = getPrismaClient();
  const processedCutoff = cutoffDate(now, PROCESSED_RETENTION_DAYS);
  const deadLetterCutoff = cutoffDate(now, DEAD_LETTER_RETENTION_DAYS);

  return prisma.$transaction(async (transaction) => {
    const retentionRun = await transaction.retentionRun.create({
      data: {
        status: RetentionRunStatus.RUNNING,
        startedAt: now,
      },
      select: { id: true },
    });

    const outboxEvents = await transaction.outboxEvent.findMany({
      where: {
        OR: [
          {
            status: "PROCESSED",
            processedAt: { lt: processedCutoff },
          },
          {
            status: "DEAD_LETTER",
            occurredAt: { lt: deadLetterCutoff },
          },
        ],
      },
      select: { id: true },
    });
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
