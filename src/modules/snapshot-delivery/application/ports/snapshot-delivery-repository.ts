import type {
  CurrentSnapshotManifest,
  DeliveryRun,
  DeliveryRunStatus,
} from "../../contracts.ts";

export type CreateDeliveryRunInput = CurrentSnapshotManifest;

export interface TransitionDeliveryRunInput {
  organizationId: string;
  projectId: string;
  publishSequence: number;
  expectedStatuses: readonly DeliveryRunStatus[];
  nextStatus: DeliveryRunStatus;
  occurredAt: Date;
  safeErrorCode?: string | null;
}

export interface SnapshotDeliveryRepository {
  publishCurrentAndCreateRun(input: CreateDeliveryRunInput): Promise<DeliveryRun>;
  getCurrentManifest(organizationId: string, projectId: string): Promise<CurrentSnapshotManifest | null>;
  getRun(organizationId: string, projectId: string, publishSequence: number): Promise<DeliveryRun | null>;
  transitionRun(input: TransitionDeliveryRunInput): Promise<DeliveryRun>;
  markStaleBefore(cutoff: Date, occurredAt: Date): Promise<number>;
}
