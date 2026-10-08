import "server-only";
import { createProjectSnapshotWebhookResolver, createSnapshotNotificationHandler } from "../modules/snapshot-delivery/server.ts";

/** Optional consumer of the EXISTING combined worker. No network at startup. */
export function createSnapshotWebhookCapability(environment: Readonly<Record<string, string | undefined>> = process.env) {
  const enabled = environment.SNAPSHOT_WEBHOOK_ENABLED;
  if (enabled === undefined || enabled === "false") return null;
  if (enabled !== "true") throw new Error("SNAPSHOT_WEBHOOK_CAPABILITY_INVALID");
  return createSnapshotNotificationHandler({ resolveEndpoint: createProjectSnapshotWebhookResolver(environment) });
}
