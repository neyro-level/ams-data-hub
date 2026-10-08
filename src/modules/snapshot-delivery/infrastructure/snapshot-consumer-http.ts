import "server-only";
import { ZodError } from "zod";
import { createProjectObjectStorageResolver } from "../../../platform/storage/project-object-storage.ts";
import { snapshotConsumerArtifactPath, snapshotConsumerScopeSchema } from "../consumer-contracts.ts";
import { createProjectSnapshotTrustResolver } from "./project-snapshot-trust.ts";
import { createSnapshotConsumerReadServer } from "./snapshot-consumer-read.ts";
import { createSnapshotConsumerAckServer } from "./snapshot-consumer-ack.ts";

const headers = { "Cache-Control": "no-store", "Vary": "Authorization", "X-Content-Type-Options": "nosniff" };
let storageRegistry: string | undefined;
let storageResolver: ReturnType<typeof createProjectObjectStorageResolver> | undefined;
function resolveStorage(scope: Parameters<ReturnType<typeof createProjectObjectStorageResolver>>[0]) {
  const registry = process.env.PROJECT_STORAGE_BINDINGS;
  if (!storageResolver || registry !== storageRegistry) {
    storageResolver = createProjectObjectStorageResolver();
    storageRegistry = registry;
  }
  return storageResolver(scope);
}
// Lazy config resolution happens only after credential + committed identity.
const dependencies = {
  resolveStorage,
  resolveTrust: (scope: Parameters<typeof resolveStorage>[0]) => createProjectSnapshotTrustResolver()(scope),
};
const consumer = createSnapshotConsumerReadServer(dependencies);
const acknowledge = createSnapshotConsumerAckServer(dependencies);
export async function handleSnapshotConsumerAck(request: Request, params: { organizationId: string; projectId: string }) {
  try {
    if (new URL(request.url).search || request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json")
      return Response.json({ error: "INVALID_REQUEST" }, { status: 400, headers });
    const reader = request.body?.getReader(); if (!reader) throw new ZodError([]);
    const parts: Uint8Array[] = []; let length = 0;
    try {
      while (true) { const next = await reader.read(); if (next.done) break; length += next.value.length;
        if (length > 4096) { await reader.cancel(); return Response.json({ error: "INVALID_REQUEST" }, { status: 413, headers }); }
        parts.push(next.value);
      }
    } finally { reader.releaseLock(); }
    let body: unknown;
    try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts))); }
    catch { return Response.json({ error: "INVALID_REQUEST" }, { status: 400, headers }); }
    return Response.json(await acknowledge(params, request.headers.get("authorization"), body, request.signal), { headers });
  } catch (error) {
    if (error instanceof ZodError) return Response.json({ error: "INVALID_REQUEST" }, { status: 400, headers });
    const code = error instanceof Error ? error.message : "";
    if (["SNAPSHOT_CONSUMER_UNAUTHORIZED", "ACK_AUTHENTICATION_FAILED", "ACK_CREDENTIAL_NOT_CONFIGURED"].includes(code))
      return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers });
    if (code === "SNAPSHOT_CONSUMER_NOT_FOUND") return Response.json({ error: "NOT_FOUND" }, { status: 404, headers });
    if (["SNAPSHOT_CONSUMER_ACK_CONFLICT", "ACK_REPLAY_REJECTED", "ACK_DELIVERY_NOT_APPLIED"].includes(code))
      return Response.json({ error: "ACK_CONFLICT" }, { status: 409, headers });
    return Response.json({ error: "SNAPSHOT_UNAVAILABLE" }, { status: 503, headers });
  }
}
export async function handleSnapshotConsumerGet(request: Request,
  params: { organizationId: string; projectId: string; publishSequence?: string; kind?: string }) {
  try {
    const scope = snapshotConsumerScopeSchema.parse({ organizationId: params.organizationId, projectId: params.projectId });
    if (new URL(request.url).search) return Response.json({ error: "INVALID_REQUEST" }, { status: 400, headers });
    if (params.publishSequence !== undefined && params.kind !== undefined) {
      const result = await consumer.artifact(scope, request.headers.get("authorization"), params.publishSequence, params.kind, request.signal);
      return new Response(result.body, { headers: { ...headers, "Content-Type": "application/gzip", "Content-Length": String(result.body.length) } });
    }
    const manifest = await consumer.current(scope, request.headers.get("authorization"), request.signal);
    return Response.json({ manifest, artifacts: manifest.files.map(({ kind }) => ({ kind,
      url: snapshotConsumerArtifactPath(scope, manifest.publishSequence, kind) })) }, { headers });
  } catch (error) {
    if (error instanceof ZodError) return Response.json({ error: "INVALID_REQUEST" }, { status: 400, headers });
    const code = error instanceof Error ? error.message : "";
    if (code === "SNAPSHOT_CONSUMER_UNAUTHORIZED") return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers: { ...headers, "WWW-Authenticate": "Bearer" } });
    if (code === "SNAPSHOT_CONSUMER_NOT_FOUND") return Response.json({ error: "NOT_FOUND" }, { status: 404, headers });
    return Response.json({ error: "SNAPSHOT_UNAVAILABLE" }, { status: 503, headers });
  }
}
