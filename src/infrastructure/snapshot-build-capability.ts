import "server-only";
import { createSnapshotBuildRequestHandler, createProjectSnapshotSigningResolver, createProjectSnapshotTrustResolver } from "../modules/snapshot-delivery/server.ts";
import { createOperationalSnapshotBuildExecutor, createOperationalSnapshotPublishExecutor } from "../modules/operations-control/server.ts";
import type { ProjectObjectStorage, ProjectStorageScope } from "../platform/storage/project-object-storage.ts";

/** Optional capability of the EXISTING combined worker, not a new process.
 * Disabled mode leaves snapshot intents reserved and old intake unaffected. */
export function createSnapshotBuildCapability(resolveStorage: (scope: ProjectStorageScope) => ProjectObjectStorage,
  environment: Readonly<Record<string, string | undefined>> = process.env) {
  const enabled = environment.SNAPSHOT_BUILD_ENABLED;
  if (enabled === undefined || enabled === "false") return null;
  if (enabled !== "true") throw new Error("SNAPSHOT_BUILD_CAPABILITY_INVALID");
  const resolveSigning = createProjectSnapshotSigningResolver(environment); // Strict registry before queue startup; no secrets resolved yet.
  return createSnapshotBuildRequestHandler({ resolvePublication: (scope) => ({ ...scope,
    ...resolveSigning(scope), storage: resolveStorage(scope) }) });
}

/** Same approved capability flag/bindings, but operational BUILD stages only. */
export function createOperationalSnapshotBuildCapability(resolveStorage: (scope: ProjectStorageScope) => ProjectObjectStorage,
  environment: Readonly<Record<string, string | undefined>> = process.env) {
  const enabled = environment.SNAPSHOT_BUILD_ENABLED;
  if (enabled === undefined || enabled === "false") return null;
  if (enabled !== "true") throw new Error("SNAPSHOT_BUILD_CAPABILITY_INVALID");
  const resolveSigning = createProjectSnapshotSigningResolver(environment);
  return createOperationalSnapshotBuildExecutor({ resolveStage: (scope) => ({ ...scope,
    ...resolveSigning(scope), storage: resolveStorage(scope) }) });
}

/** Independent public-only capability; BUILD/signing can remain disabled. */
export function createOperationalSnapshotPublishCapability(resolveStorage: (scope: ProjectStorageScope) => ProjectObjectStorage,
  environment: Readonly<Record<string, string | undefined>> = process.env) {
  const enabled = environment.SNAPSHOT_PUBLISH_ENABLED;
  if (enabled === undefined || enabled === "false") return null;
  if (enabled !== "true") throw new Error("SNAPSHOT_PUBLISH_CAPABILITY_INVALID");
  const resolveTrust = createProjectSnapshotTrustResolver(environment);
  return createOperationalSnapshotPublishExecutor({ resolvePublication: (scope) => ({ ...scope,
    storage: resolveStorage(scope), getTrust: () => resolveTrust(scope) }) });
}
