import { createHash } from "node:crypto";
import { snapshotInputRequestHashes } from "../../snapshot-delivery/index.ts";

/** Request-owned identity, stable across queue attempts; never latest capture. */
export function operationalSnapshotBuildRequest(scope: { organizationId: string; projectId: string }, requestId: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(requestId)) throw new Error("OPERATIONS_CONTROL_REFERENCE_INVALID");
  const request = { organizationId: scope.organizationId, projectId: scope.projectId, schemaMinor: 0,
    idempotencyKey: createHash("sha256").update(`operational-snapshot-build-v1:${requestId}`).digest("hex") };
  return { request, lookup: snapshotInputRequestHashes(request) };
}
