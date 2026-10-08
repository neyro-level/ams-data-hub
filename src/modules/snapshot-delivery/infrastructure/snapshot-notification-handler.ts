import "server-only";
import { Prisma } from "../../../generated/prisma/client.ts";
import { runInAuthorizedDatabaseTransaction } from "../../../platform/database/transaction.ts";
import { safeOutboundWebhook } from "../../../platform/http/safe-outbound.ts";
import type { ClaimedReliabilityEvent } from "../../platform-operations/index.ts";
import { lockOperationalOutboxLease } from "../../platform-operations/server.ts";
import { SNAPSHOT_NOTIFICATION_TOPIC, snapshotNotificationIntentSchema } from "../contracts.ts";
import { PrismaSnapshotDeliveryRepository } from "./prisma-snapshot-delivery-repository.ts";
import { lockSnapshotPublication } from "./snapshot-publication-lock.ts";

function failure(code: "SNAPSHOT_NOTIFICATION_INVALID" | "SNAPSHOT_NOTIFICATION_UNAVAILABLE", retryable: boolean) {
  return Object.assign(new Error(code), { code, retryable });
}
/** Existing outbox owns retry/settlement. A webhook can never undo publication. */
export function createSnapshotNotificationHandler(dependencies: {
  resolveEndpoint(scope: { organizationId: string; projectId: string }): URL | null;
  send?: typeof safeOutboundWebhook;
}) {
  return async (lease: ClaimedReliabilityEvent, signal?: AbortSignal) => {
    const parsed = snapshotNotificationIntentSchema.safeParse(lease.payload);
    if (!parsed.success || lease.topic !== SNAPSHOT_NOTIFICATION_TOPIC || lease.schemaVersion !== 1
      || lease.organizationId !== parsed.data.organizationId) throw failure("SNAPSHOT_NOTIFICATION_INVALID", false);
    const input = parsed.data;
    const scope = { organizationId: input.organizationId, projectId: input.projectId };
    const cancelled = () => { if (signal?.aborted) throw failure("SNAPSHOT_NOTIFICATION_UNAVAILABLE", true); };
    const cut = (notified: boolean) => runInAuthorizedDatabaseTransaction({ principalKind: "project-job", actorId: "snapshot-notifier",
      ...scope, projectIds: [scope.projectId], correlationId: lease.correlationId }, async (tx) => {
      await lockSnapshotPublication(tx, scope);
      await lockOperationalOutboxLease(tx, lease, { ...scope, topic: SNAPSHOT_NOTIFICATION_TOPIC, payload: input }, "snapshot-notifier");
      await tx.$executeRaw(Prisma.sql`SELECT set_config('app.snapshot_notification_sequence',${String(input.publishSequence)},true)`);
      cancelled();
      const repository = new PrismaSnapshotDeliveryRepository(tx);
      const run = await repository.getRun(scope.organizationId, scope.projectId, input.publishSequence);
      if (!run || run.deliveryRunId !== input.deliveryRunId) throw failure("SNAPSHOT_NOTIFICATION_INVALID", false);
      if (notified && run.status === "PENDING") await repository.transitionRun({ ...scope,
        publishSequence: input.publishSequence, expectedStatuses: ["PENDING"], nextStatus: "NOTIFIED", occurredAt: new Date() });
      cancelled();
      return run.status === "PENDING";
    }, { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 5000 });
    try {
      cancelled();
      if (!await cut(false)) return;
      const endpoint = dependencies.resolveEndpoint(scope);
      if (!endpoint) return { deferred: true as const, code: "OUTBOX_EXECUTOR_RESERVED" as const };
      cancelled();
      await (dependencies.send ?? safeOutboundWebhook)(endpoint,
        { projectId: scope.projectId, publishSequence: input.publishSequence }, signal ? { signal } : {});
      cancelled();
      await cut(true); // Lease/ACK may have changed during IO; never downgrade.
    } catch (error) {
      if (error instanceof Error && error.message === "SNAPSHOT_NOTIFICATION_INVALID") throw error;
      throw failure("SNAPSHOT_NOTIFICATION_UNAVAILABLE", true); // No URLs/transport diagnostics escape.
    }
  };
}
