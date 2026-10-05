import type {
  CurrentSnapshotManifest,
  DeliveryRun,
  DeliveryRunStatus,
  ProjectAckCredential,
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
  getAckCredential(organizationId: string, projectId: string): Promise<ProjectAckCredential | null>;
  saveAckCredential(input: Omit<ProjectAckCredential, "version"> & { expectedVersion: number; rotatedAt: Date | null }): Promise<ProjectAckCredential>;
  acknowledgeApplied(input: {
    organizationId: string;
    projectId: string;
    publishSequence: number;
    idempotencyKeyHash: string;
    acknowledgedAt: Date;
  }): Promise<{ run: DeliveryRun; idempotent: boolean }>;
}
