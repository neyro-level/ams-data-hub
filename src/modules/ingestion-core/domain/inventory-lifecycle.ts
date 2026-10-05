import { createUlid } from "@ams-data-hub/data-contracts";

export type InventoryLifecycleStatus = "ACTIVE" | "INACTIVE";
export type InventoryLifecycleEventType = "INACTIVATED" | "REACTIVATED";

export interface InventoryIdentityState {
  organizationId: string;
  projectId: string;
  sourceId: string;
  externalOfferId: string;
  uid: string;
  status: InventoryLifecycleStatus;
  firstSeenAt: Date;
  lastSeenAt: Date;
  missingGoodRuns: number;
  missingSince: Date | null;
  sourceCreatedAt: Date | null;
  sourceUpdatedAt: Date | null;
  sourceHash: string;
  normalizedHash: string;
  version: number;
}

export interface InventoryLifecyclePolicy {
  deactivationEnabled: boolean;
  inactiveAfterMissingGoodRuns: number;
  inactiveAfterMissingHours: number;
}

export interface InventorySeenInput {
  organizationId: string;
  projectId: string;
  sourceId: string;
  externalOfferId: string;
  sourceHash: string;
  normalizedHash: string;
  sourceCreatedAt?: Date | null;
  sourceUpdatedAt?: Date | null;
  seenAt: Date;
}

export interface InventoryMissingRunContext {
  completedGoodRun: boolean;
  baseline: boolean;
  suspicious: boolean;
  occurredAt: Date;
}

export interface InventoryLifecycleDecision {
  state: InventoryIdentityState;
  outcome: "CREATED" | "UPDATED" | "MISSING_GRACE" | "INACTIVATED" | "REACTIVATED" | "UNCHANGED";
  event: InventoryLifecycleEventType | null;
}

function assertHash(value: string, field: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error(`INVENTORY_${field}_INVALID`);
}

export function reconcileSeenInventory(
  current: InventoryIdentityState | null,
  input: InventorySeenInput,
  createUid: (timestamp?: number) => string = createUlid,
): InventoryLifecycleDecision {
  const externalOfferId = input.externalOfferId.trim();
  if (!externalOfferId || externalOfferId.length > 240) throw new Error("INVENTORY_EXTERNAL_OFFER_ID_INVALID");
  assertHash(input.sourceHash, "SOURCE_HASH");
  assertHash(input.normalizedHash, "NORMALIZED_HASH");
  if (!current) {
    return {
      state: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        sourceId: input.sourceId,
        externalOfferId,
        uid: createUid(input.seenAt.getTime()),
        status: "ACTIVE",
        firstSeenAt: input.seenAt,
        lastSeenAt: input.seenAt,
        missingGoodRuns: 0,
        missingSince: null,
        sourceCreatedAt: input.sourceCreatedAt ?? null,
        sourceUpdatedAt: input.sourceUpdatedAt ?? null,
        sourceHash: input.sourceHash,
        normalizedHash: input.normalizedHash,
        version: 1,
      },
      outcome: "CREATED",
      event: null,
    };
  }
  if (
    current.organizationId !== input.organizationId
    || current.projectId !== input.projectId
    || current.sourceId !== input.sourceId
    || current.externalOfferId !== externalOfferId
  ) throw new Error("INVENTORY_IDENTITY_SCOPE_MISMATCH");
  if (input.seenAt < current.lastSeenAt) throw new Error("INVENTORY_SEEN_AT_STALE");

  const reactivated = current.status === "INACTIVE";
  return {
    state: {
      ...current,
      status: "ACTIVE",
      lastSeenAt: input.seenAt,
      missingGoodRuns: 0,
      missingSince: null,
      sourceCreatedAt: input.sourceCreatedAt ?? current.sourceCreatedAt,
      sourceUpdatedAt: input.sourceUpdatedAt ?? current.sourceUpdatedAt,
      sourceHash: input.sourceHash,
      normalizedHash: input.normalizedHash,
      version: current.version + 1,
    },
    outcome: reactivated ? "REACTIVATED" : "UPDATED",
    event: reactivated ? "REACTIVATED" : null,
  };
}

export function reconcileMissingInventory(
  current: InventoryIdentityState,
  policy: InventoryLifecyclePolicy,
  run: InventoryMissingRunContext,
): InventoryLifecycleDecision {
  if (!Number.isInteger(policy.inactiveAfterMissingGoodRuns) || policy.inactiveAfterMissingGoodRuns < 1) {
    throw new Error("INVENTORY_MISSING_RUN_POLICY_INVALID");
  }
  if (!Number.isFinite(policy.inactiveAfterMissingHours) || policy.inactiveAfterMissingHours < 0) {
    throw new Error("INVENTORY_MISSING_HOURS_POLICY_INVALID");
  }
  if (run.occurredAt < current.lastSeenAt) throw new Error("INVENTORY_MISSING_RUN_STALE");
  if (current.status === "INACTIVE" || !run.completedGoodRun || run.baseline || run.suspicious) {
    return { state: current, outcome: "UNCHANGED", event: null };
  }
  const missingGoodRuns = current.missingGoodRuns + 1;
  const missingSince = current.missingSince ?? run.occurredAt;
  const missingHours = Math.max(0, run.occurredAt.getTime() - missingSince.getTime()) / 3_600_000;
  const eligible = policy.deactivationEnabled
    && missingGoodRuns >= policy.inactiveAfterMissingGoodRuns
    && missingHours >= policy.inactiveAfterMissingHours;
  return {
    state: {
      ...current,
      status: eligible ? "INACTIVE" : "ACTIVE",
      missingGoodRuns,
      missingSince,
      version: current.version + 1,
    },
    outcome: eligible ? "INACTIVATED" : "MISSING_GRACE",
    event: eligible ? "INACTIVATED" : null,
  };
}
