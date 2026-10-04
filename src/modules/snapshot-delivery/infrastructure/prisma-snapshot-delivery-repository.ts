import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { CurrentSnapshotManifest, DeliveryRun, DeliveryRunStatus } from "../contracts.ts";
import { assertDeliveryTransition } from "../domain/delivery-run.ts";
import type {
  CreateDeliveryRunInput,
  SnapshotDeliveryRepository,
  TransitionDeliveryRunInput,
} from "../application/ports/snapshot-delivery-repository.ts";

type StoredDeliveryRun = {
  id: string;
  organizationId: string;
  projectId: string;
  publishSequence: number;
  manifestKey: string;
  manifestSha256: string;
  status: DeliveryRunStatus;
  publishedAt: Date;
  notifiedAt: Date | null;
  downloadedAt: Date | null;
  appliedAt: Date | null;
  acknowledgedAt: Date | null;
  failedAt: Date | null;
  staleAt: Date | null;
  safeErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRun(row: StoredDeliveryRun): DeliveryRun {
  return { ...row, deliveryRunId: row.id };
}

function transitionTimestamp(nextStatus: DeliveryRunStatus, occurredAt: Date) {
  switch (nextStatus) {
    case "NOTIFIED": return { notifiedAt: occurredAt };
    case "DOWNLOADED": return { downloadedAt: occurredAt };
    case "APPLIED": return { appliedAt: occurredAt };
    case "ACKNOWLEDGED": return { acknowledgedAt: occurredAt };
    case "FAILED": return { failedAt: occurredAt };
    case "STALE": return { staleAt: occurredAt };
    case "PENDING": return {};
  }
}

export class PrismaSnapshotDeliveryRepository implements SnapshotDeliveryRepository {
  constructor(private readonly transaction: DatabaseTransaction) {}

  async publishCurrentAndCreateRun(input: CreateDeliveryRunInput): Promise<DeliveryRun> {
    const current = await this.transaction.projectCurrentSnapshotManifest.findUnique({
      where: { organizationId_projectId: { organizationId: input.organizationId, projectId: input.projectId } },
      select: { publishSequence: true },
    });
    if (current && input.publishSequence <= current.publishSequence) {
      throw new Error("SNAPSHOT_DELIVERY_SEQUENCE_STALE");
    }
    await this.transaction.projectCurrentSnapshotManifest.upsert({
      where: { organizationId_projectId: { organizationId: input.organizationId, projectId: input.projectId } },
      create: input,
      update: {
        publishSequence: input.publishSequence,
        manifestKey: input.manifestKey,
        manifestSha256: input.manifestSha256,
        publishedAt: input.publishedAt,
      },
    });
    const run = await this.transaction.deliveryRun.create({ data: input });
    return toRun(run as StoredDeliveryRun);
  }

  async getCurrentManifest(organizationId: string, projectId: string): Promise<CurrentSnapshotManifest | null> {
    return this.transaction.projectCurrentSnapshotManifest.findUnique({
      where: { organizationId_projectId: { organizationId, projectId } },
      select: { organizationId: true, projectId: true, publishSequence: true, manifestKey: true, manifestSha256: true, publishedAt: true },
    });
  }

  async getRun(organizationId: string, projectId: string, publishSequence: number): Promise<DeliveryRun | null> {
    const run = await this.transaction.deliveryRun.findUnique({
      where: { organizationId_projectId_publishSequence: { organizationId, projectId, publishSequence } },
    });
    return run ? toRun(run as StoredDeliveryRun) : null;
  }

  async transitionRun(input: TransitionDeliveryRunInput): Promise<DeliveryRun> {
    for (const status of input.expectedStatuses) assertDeliveryTransition(status, input.nextStatus);
    const updated = await this.transaction.deliveryRun.updateMany({
      where: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        publishSequence: input.publishSequence,
        status: { in: [...input.expectedStatuses] },
      },
      data: {
        status: input.nextStatus,
        ...transitionTimestamp(input.nextStatus, input.occurredAt),
        ...(input.safeErrorCode === undefined ? {} : { safeErrorCode: input.safeErrorCode }),
      },
    });
    if (updated.count !== 1) throw new Error("DELIVERY_TRANSITION_CONFLICT");
    const run = await this.getRun(input.organizationId, input.projectId, input.publishSequence);
    if (!run) throw new Error("DELIVERY_RUN_NOT_FOUND");
    return run;
  }

  async markStaleBefore(cutoff: Date, occurredAt: Date): Promise<number> {
    const result = await this.transaction.deliveryRun.updateMany({
      where: {
        status: { in: ["PENDING", "NOTIFIED", "DOWNLOADED", "APPLIED"] },
        createdAt: { lte: cutoff },
      },
      data: { status: "STALE", staleAt: occurredAt },
    });
    return result.count;
  }
}
