import "server-only";
import { createHash } from "node:crypto";
import { canonicalJson } from "@ams-data-hub/data-contracts";
import { createProjectJobPrincipal } from "../../../platform/authorization/principal-factories.ts";
import { assertSnapshotSourceGoodTrigger } from "../../ingestion-core/server.ts";
import type { ClaimedReliabilityEvent } from "../../platform-operations/index.ts";
import { SNAPSHOT_BUILD_REQUEST_TOPIC, sourceGoodSnapshotBuildRequestSchema } from "../contracts.ts";
import { snapshotInputRequestHashes } from "../application/snapshot-build-input.ts";
import { captureSnapshotInput } from "./snapshot-input-capture-command.ts";
import { createSnapshotPublicationServer } from "./snapshot-publication.ts";
import { inspectSnapshotPublicationServer } from "./snapshot-publication-replay.ts";

function failed(code: "SNAPSHOT_BUILD_REQUEST_INVALID" | "SNAPSHOT_BUILD_CANCELLED" | "SNAPSHOT_BUILD_REJECTED" | "SNAPSHOT_BUILD_UNAVAILABLE", retryable: boolean) {
  return Object.assign(new Error(code), { code, retryable });
}
function checkSignal(signal?: AbortSignal) {
  if (signal?.aborted) throw failed("SNAPSHOT_BUILD_CANCELLED", true);
}
function safeFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "SNAPSHOT_PUBLICATION_CANCELLED" || message === "SNAPSHOT_BUILD_CANCELLED") return failed("SNAPSHOT_BUILD_CANCELLED", true);
  const terminal = /^(SNAPSHOT_PUBLICATION_(?:.*_STALE|.*_INVALID|.*_CONFLICT|JOBS_FROZEN|PROJECT_BLOCKED|.*_ACCESS_DENIED)|SNAPSHOT_INPUT_(?:.*_INVALID|IDEMPOTENCY_CONFLICT|JOBS_FROZEN|PROJECT_BLOCKED|ACCESS_DENIED)|SNAPSHOT_DELIVERY_(?:SEQUENCE_STALE|MANIFEST_CONFLICT))$/u;
  return failed(terminal.test(message) ? "SNAPSHOT_BUILD_REJECTED" : "SNAPSHOT_BUILD_UNAVAILABLE", !terminal.test(message));
}

/** Exact-topic server-owned executor. Reliability settlement remains worker-owned
 * and fenced; a lost completion lease cannot undo a committed publication. */
export function createSnapshotBuildRequestHandler(dependencies: {
  resolvePublication(scope: { organizationId: string; projectId: string }):
    Parameters<typeof createSnapshotPublicationServer>[0] | Promise<Parameters<typeof createSnapshotPublicationServer>[0]>;
}) {
  return async (event: ClaimedReliabilityEvent, signal?: AbortSignal): Promise<void> => {
    const payload = sourceGoodSnapshotBuildRequestSchema.safeParse(event.payload);
    if (event.topic !== SNAPSHOT_BUILD_REQUEST_TOPIC || event.schemaVersion !== 1 || !payload.success
      || event.organizationId !== payload.data.organizationId || !/^[A-Za-z0-9_-]{1,128}$/u.test(event.outboxEventId)) {
      throw failed("SNAPSHOT_BUILD_REQUEST_INVALID", false);
    }
    checkSignal(signal);
    const scope = { organizationId: payload.data.organizationId, projectId: payload.data.projectId };
    const principal = createProjectJobPrincipal({ ...scope, jobName: "snapshot-input", correlationId: event.correlationId });
    const request = { ...scope, schemaMinor: 0,
      idempotencyKey: createHash("sha256").update(canonicalJson(["snapshot-build-outbox-v1", event.outboxEventId])).digest("hex") };
    const lookup = snapshotInputRequestHashes(request);
    try {
      const inspected = await inspectSnapshotPublicationServer(principal, lookup);
      if (inspected.run) return; // No fresh admission, config, signer or object IO.
      checkSignal(signal);
      await assertSnapshotSourceGoodTrigger(principal, payload.data);
      checkSignal(signal);
      const bound = await dependencies.resolvePublication(scope);
      if (bound.organizationId !== scope.organizationId || bound.projectId !== scope.projectId) {
        throw failed("SNAPSHOT_BUILD_REQUEST_INVALID", false);
      }
      checkSignal(signal);
      if (!inspected.receipt) await captureSnapshotInput(principal, request);
      checkSignal(signal);
      await createSnapshotPublicationServer(bound)(principal, lookup, signal);
    } catch (error) {
      // Config/capture/staging failure may race another attempt's durable commit.
      // Inspection itself needs no signer/storage binding, even after rotation.
      try { if ((await inspectSnapshotPublicationServer(principal, lookup)).run) return; } catch { /* Keep a finite error below. */ }
      checkSignal(signal);
      if (error instanceof Error && error.message === "SNAPSHOT_BUILD_REQUEST_INVALID") throw failed("SNAPSHOT_BUILD_REQUEST_INVALID", false);
      throw safeFailure(error); // Never propagate SDK/DB/config messages, URLs or secret values.
    }
  };
}
