import type { DeliveryRunStatus } from "../contracts.ts";

const ACTIVE_STATUSES: readonly DeliveryRunStatus[] = ["PENDING", "NOTIFIED", "DOWNLOADED", "APPLIED"];

const TRANSITIONS: Readonly<Record<DeliveryRunStatus, readonly DeliveryRunStatus[]>> = {
  PENDING: ["NOTIFIED", "DOWNLOADED", "FAILED", "STALE"],
  NOTIFIED: ["DOWNLOADED", "FAILED", "STALE"],
  DOWNLOADED: ["APPLIED", "FAILED", "STALE"],
  APPLIED: ["ACKNOWLEDGED", "FAILED", "STALE"],
  ACKNOWLEDGED: [],
  FAILED: [],
  STALE: [],
};

export const DELIVERY_STALE_AFTER_MS = 24 * 60 * 60 * 1_000;

export function isActiveDeliveryStatus(status: DeliveryRunStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export function assertDeliveryTransition(from: DeliveryRunStatus, to: DeliveryRunStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new Error(`DELIVERY_TRANSITION_INVALID:${from}:${to}`);
  }
}

export function deliveryStaleCutoff(now: Date): Date {
  return new Date(now.getTime() - DELIVERY_STALE_AFTER_MS);
}
