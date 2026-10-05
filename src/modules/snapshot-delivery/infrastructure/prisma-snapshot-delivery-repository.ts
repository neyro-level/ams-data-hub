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
  ackIdempotencyKeyHash: string | null;
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

  async getAckCredential(organizationId: string, projectId: string) {
    return this.transaction.projectAckCredential.findUnique({
      where: { organizationId_projectId: { organizationId, projectId } },
      select: { organizationId: true, projectId: true, currentTokenHash: true, nextTokenHash: true, version: true },
    });
  }

  async saveAckCredential(input: {
    organizationId: string;
    projectId: string;
    currentTokenHash: string;
    nextTokenHash: string | null;
    expectedVersion: number;
    rotatedAt: Date | null;
  }) {
    if (input.expectedVersion === 0) {
      return this.transaction.projectAckCredential.create({
        data: {
          organizationId: input.organizationId,
          projectId: input.projectId,
          currentTokenHash: input.currentTokenHash,
          nextTokenHash: input.nextTokenHash,
          rotatedAt: input.rotatedAt,
        },
        select: { organizationId: true, projectId: true, currentTokenHash: true, nextTokenHash: true, version: true },
      });
    }
    const updated = await this.transaction.projectAckCredential.updateMany({
      where: { organizationId: input.organizationId, projectId: input.projectId, version: input.expectedVersion },
      data: {
        currentTokenHash: input.currentTokenHash,
        nextTokenHash: input.nextTokenHash,
        rotatedAt: input.rotatedAt,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new Error("ACK_CREDENTIAL_STALE");
    const credential = await this.getAckCredential(input.organizationId, input.projectId);
    if (!credential) throw new Error("ACK_CREDENTIAL_NOT_FOUND");
    return credential;
  }

  async acknowledgeApplied(input: {
    organizationId: string;
    projectId: string;
    publishSequence: number;
    idempotencyKeyHash: string;
    acknowledgedAt: Date;
  }): Promise<{ run: DeliveryRun; idempotent: boolean }> {
    const existing = await this.getRun(input.organizationId, input.projectId, input.publishSequence);
    if (!existing) throw new Error("ACK_DELIVERY_RUN_NOT_FOUND");
    if (existing.status === "ACKNOWLEDGED") {
      if (existing.ackIdempotencyKeyHash !== input.idempotencyKeyHash) throw new Error("ACK_REPLAY_REJECTED");
      return { run: existing, idempotent: true };
    }
    if (existing.status !== "APPLIED") throw new Error("ACK_DELIVERY_NOT_APPLIED");
    const updated = await this.transaction.deliveryRun.updateMany({
      where: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        publishSequence: input.publishSequence,
        status: "APPLIED",
        ackIdempotencyKeyHash: null,
      },
      data: {
        status: "ACKNOWLEDGED",
        acknowledgedAt: input.acknowledgedAt,
        ackIdempotencyKeyHash: input.idempotencyKeyHash,
      },
    });
    if (updated.count !== 1) {
      const concurrent = await this.getRun(input.organizationId, input.projectId, input.publishSequence);
      if (concurrent?.status === "ACKNOWLEDGED" && concurrent.ackIdempotencyKeyHash === input.idempotencyKeyHash) {
        return { run: concurrent, idempotent: true };
      }
      throw new Error("ACK_REPLAY_REJECTED");
    }
    const run = await this.getRun(input.organizationId, input.projectId, input.publishSequence);
    if (!run) throw new Error("ACK_DELIVERY_RUN_NOT_FOUND");
    return { run, idempotent: false };
  }
}
