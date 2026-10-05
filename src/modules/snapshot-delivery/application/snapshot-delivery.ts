import { canonicalJsonBytes, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import type { ProjectSnapshotStorage } from "../../../platform/storage/object-storage.ts";
import { calculateObjectSha256 } from "../../../platform/storage/object-storage.ts";
import { assertProjectOperationAllowed, type ProjectServiceState } from "../../project-registry/index.ts";
import type {
  CurrentSnapshotManifest,
  DeliveryRun,
  DeliveryRunStatus,
  SnapshotComposition,
  SnapshotManifestV1,
} from "../contracts.ts";
import { deliveryStaleCutoff } from "../domain/delivery-run.ts";
import type { SnapshotDeliveryRepository } from "./ports/snapshot-delivery-repository.ts";

export interface SnapshotWebhookNotification {
  projectId: string;
  publishSequence: number;
}

export interface SnapshotWebhookNotifier {
  notify(notification: SnapshotWebhookNotification): Promise<void>;
}

export interface SnapshotDeliveryDependencies {
  repository: SnapshotDeliveryRepository;
  createProjectStorage(projectId: string): ProjectSnapshotStorage;
  now(): Date;
}

export interface PublishSnapshotInput {
  organizationId: string;
  composition: SnapshotComposition;
  manifest: SnapshotManifestV1;
}

async function storeSnapshot(input: PublishSnapshotInput, storage: ProjectSnapshotStorage): Promise<CurrentSnapshotManifest> {
  const { composition, manifest, organizationId } = input;
  if (composition.manifest.projectId !== manifest.projectId || composition.manifest.publishSequence !== manifest.publishSequence) {
    throw new Error("SNAPSHOT_DELIVERY_MANIFEST_MISMATCH");
  }
  await Promise.all(composition.files.map((file) => storage.put({
    body: file.body,
    contentType: "application/gzip",
    sha256: file.manifest.sha256,
  })));
  const manifestBody = canonicalJsonBytes(manifest as unknown as CanonicalJsonValue);
  const manifestSha256 = calculateObjectSha256(manifestBody);
  const storedManifest = await storage.put({
    body: manifestBody,
    contentType: "application/json",
    sha256: manifestSha256,
  });
  return {
    organizationId,
    projectId: manifest.projectId,
    publishSequence: manifest.publishSequence,
    manifestKey: storedManifest.key,
    manifestSha256,
    publishedAt: new Date(manifest.publishedAt),
  };
}

export function createSnapshotDeliveryService(dependencies: SnapshotDeliveryDependencies) {
  const transition = async (
    run: Pick<DeliveryRun, "organizationId" | "projectId" | "publishSequence">,
    expectedStatuses: readonly DeliveryRunStatus[],
    nextStatus: DeliveryRunStatus,
    safeErrorCode?: string,
  ) => dependencies.repository.transitionRun({
    ...run,
    expectedStatuses,
    nextStatus,
    occurredAt: dependencies.now(),
    safeErrorCode,
  });

  return {
    stageArtifacts(input: PublishSnapshotInput): Promise<CurrentSnapshotManifest> {
      return storeSnapshot(input, dependencies.createProjectStorage(input.manifest.projectId));
    },
    registerPublication(current: CurrentSnapshotManifest, serviceState: ProjectServiceState): Promise<DeliveryRun> {
      assertProjectOperationAllowed(serviceState, "PUBLISH");
      return dependencies.repository.publishCurrentAndCreateRun(current);
    },
    webhookSignal(run: Pick<DeliveryRun, "projectId" | "publishSequence">): SnapshotWebhookNotification {
      return { projectId: run.projectId, publishSequence: run.publishSequence };
    },
    recordNotified(run: DeliveryRun) {
      return transition(run, ["PENDING"], "NOTIFIED");
    },
    getCurrentManifest(organizationId: string, projectId: string) {
      return dependencies.repository.getCurrentManifest(organizationId, projectId);
    },
    recordDownloaded(run: DeliveryRun) {
      return transition(run, ["PENDING", "NOTIFIED"], "DOWNLOADED");
    },
    recordApplied(run: DeliveryRun) {
      return transition(run, ["DOWNLOADED"], "APPLIED");
    },
    recordAcknowledged(run: DeliveryRun) {
      return transition(run, ["APPLIED"], "ACKNOWLEDGED");
    },
    recordFailed(run: DeliveryRun, safeErrorCode: string) {
      return transition(run, ["PENDING", "NOTIFIED", "DOWNLOADED", "APPLIED"], "FAILED", safeErrorCode);
    },
    markStaleDeliveries() {
      const now = dependencies.now();
      return dependencies.repository.markStaleBefore(deliveryStaleCutoff(now), now);
    },
  };
}
