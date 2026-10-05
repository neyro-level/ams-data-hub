import { describe, expect, it } from "vitest";
import {
  reconcileMissingInventory,
  reconcileSeenInventory,
  type InventoryIdentityState,
} from "../src/modules/ingestion-core/index.ts";
import { createInventoryIdentityCommands } from "../src/modules/ingestion-core/application/inventory-identity-commands.ts";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const UID = "01J9ZK8G7Q5X6NP3ABCDEF0123";
const POLICY = {
  deactivationEnabled: true,
  inactiveAfterMissingGoodRuns: 2,
  inactiveAfterMissingHours: 24,
} as const;

function createState(): InventoryIdentityState {
  return reconcileSeenInventory(null, {
    organizationId: "org-1",
    projectId: "project-1",
    sourceId: "source-1",
    externalOfferId: "offer-42",
    sourceHash: HASH_A,
    normalizedHash: HASH_A,
    seenAt: new Date("2026-10-01T00:00:00.000Z"),
  }, () => UID).state;
}

describe("inventory identity lifecycle", () => {
  it("uses the project/source/external identity and preserves uid across edits", () => {
    const first = createState();
    const updated = reconcileSeenInventory(first, {
      organizationId: "org-1",
      projectId: "project-1",
      sourceId: "source-1",
      externalOfferId: "offer-42",
      sourceHash: HASH_B,
      normalizedHash: HASH_B,
      seenAt: new Date("2026-10-01T01:00:00.000Z"),
    }, () => { throw new Error("must not allocate a second uid"); });

    expect(updated.state).toMatchObject({ uid: UID, status: "ACTIVE", sourceHash: HASH_B, normalizedHash: HASH_B });
    expect(updated.event).toBeNull();
  });

  it("keeps uid, public URL identity and ACTIVE status when an offer returns during grace", () => {
    const first = createState();
    const publicUrlByUid = new Map([[first.uid, "/offers/synthetic-01j9zk8g7q5x6np3"]]);
    const missing = reconcileMissingInventory(first, POLICY, {
      completedGoodRun: true,
      baseline: false,
      suspicious: false,
      occurredAt: new Date("2026-10-01T01:00:00.000Z"),
    });
    expect(missing).toMatchObject({ outcome: "MISSING_GRACE", event: null, state: { status: "ACTIVE", missingGoodRuns: 1 } });

    const returned = reconcileSeenInventory(missing.state, {
      organizationId: "org-1",
      projectId: "project-1",
      sourceId: "source-1",
      externalOfferId: "offer-42",
      sourceHash: HASH_B,
      normalizedHash: HASH_B,
      seenAt: new Date("2026-10-01T02:00:00.000Z"),
    });
    expect(returned).toMatchObject({ outcome: "UPDATED", event: null, state: { uid: UID, status: "ACTIVE", missingGoodRuns: 0, missingSince: null } });
    expect(publicUrlByUid.get(returned.state.uid)).toBe("/offers/synthetic-01j9zk8g7q5x6np3");
  });

  it("requires both run and time grace before deactivation, then audits reactivation", () => {
    const first = createState();
    const runOne = reconcileMissingInventory(first, POLICY, {
      completedGoodRun: true, baseline: false, suspicious: false,
      occurredAt: new Date("2026-10-01T01:00:00.000Z"),
    });
    const tooEarly = reconcileMissingInventory(runOne.state, POLICY, {
      completedGoodRun: true, baseline: false, suspicious: false,
      occurredAt: new Date("2026-10-02T00:59:59.999Z"),
    });
    expect(tooEarly).toMatchObject({ outcome: "MISSING_GRACE", event: null, state: { status: "ACTIVE", missingGoodRuns: 2 } });

    const inactive = reconcileMissingInventory(tooEarly.state, POLICY, {
      completedGoodRun: true, baseline: false, suspicious: false,
      occurredAt: new Date("2026-10-02T01:00:00.000Z"),
    });
    expect(inactive).toMatchObject({ outcome: "INACTIVATED", event: "INACTIVATED", state: { uid: UID, status: "INACTIVE" } });

    const reactivated = reconcileSeenInventory(inactive.state, {
      organizationId: "org-1", projectId: "project-1", sourceId: "source-1", externalOfferId: "offer-42",
      sourceHash: HASH_B, normalizedHash: HASH_B, seenAt: new Date("2026-10-02T02:00:00.000Z"),
    });
    expect(reactivated).toMatchObject({ outcome: "REACTIVATED", event: "REACTIVATED", state: { uid: UID, status: "ACTIVE" } });
  });

  it("never advances destructive grace on baseline, suspicious or failed runs", () => {
    const first = createState();
    for (const context of [
      { completedGoodRun: true, baseline: true, suspicious: false },
      { completedGoodRun: true, baseline: false, suspicious: true },
      { completedGoodRun: false, baseline: false, suspicious: false },
    ]) {
      expect(reconcileMissingInventory(first, POLICY, {
        ...context,
        occurredAt: new Date("2026-10-03T00:00:00.000Z"),
      })).toMatchObject({ outcome: "UNCHANGED", event: null, state: { missingGoodRuns: 0, status: "ACTIVE" } });
    }
  });

  it("keeps lifecycle mutation behind a job principal", async () => {
    const commands = createInventoryIdentityCommands({
      createRepository: () => { throw new Error("repository must not be reached"); },
      createUid: () => UID,
    });
    expect(() => commands.recordSeen({
      kind: "platform-admin",
      userId: "admin-1",
      correlationId: "correlation-1",
    }, {
      organizationId: "org-1",
      projectId: "project-1",
      sourceId: "source-1",
      externalOfferId: "offer-42",
      sourceHash: HASH_A,
      normalizedHash: HASH_A,
      seenAt: new Date("2026-10-01T00:00:00.000Z"),
    })).toThrow("INVENTORY_IDENTITY_JOB_REQUIRED");
  });
});
