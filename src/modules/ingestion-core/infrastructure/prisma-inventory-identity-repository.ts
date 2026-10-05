import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { InventoryIdentityKey, InventoryIdentityRepository } from "../application/ports/inventory-identity-repository.ts";
import type { InventoryIdentityState, InventoryLifecycleEventType } from "../domain/inventory-lifecycle.ts";

function toState(row: InventoryIdentityState): InventoryIdentityState {
  return { ...row };
}

export class PrismaInventoryIdentityRepository implements InventoryIdentityRepository {
  constructor(private readonly transaction: DatabaseTransaction) {}

  async find(key: InventoryIdentityKey): Promise<InventoryIdentityState | null> {
    const row = await this.transaction.inventoryIdentity.findUnique({
      where: { organizationId_projectId_sourceId_externalOfferId: key },
    });
    return row ? toState(row) : null;
  }

  async save(input: {
    state: InventoryIdentityState;
    expectedVersion: number | null;
    event: InventoryLifecycleEventType | null;
    occurredAt: Date;
  }): Promise<InventoryIdentityState> {
    const state = input.state;
    if (input.expectedVersion === null) {
      return toState(await this.transaction.inventoryIdentity.create({ data: state }));
    }
    const updated = await this.transaction.inventoryIdentity.updateMany({
      where: {
        uid: state.uid,
        organizationId: state.organizationId,
        projectId: state.projectId,
        sourceId: state.sourceId,
        externalOfferId: state.externalOfferId,
        version: input.expectedVersion,
      },
      data: {
        status: state.status,
        lastSeenAt: state.lastSeenAt,
        missingGoodRuns: state.missingGoodRuns,
        missingSince: state.missingSince,
        sourceCreatedAt: state.sourceCreatedAt,
        sourceUpdatedAt: state.sourceUpdatedAt,
        sourceHash: state.sourceHash,
        normalizedHash: state.normalizedHash,
        version: state.version,
      },
    });
    if (updated.count !== 1) throw new Error("INVENTORY_IDENTITY_STALE");
    if (input.event) {
      await this.transaction.inventoryLifecycleEvent.create({
        data: {
          organizationId: state.organizationId,
          projectId: state.projectId,
          inventoryUid: state.uid,
          type: input.event,
          occurredAt: input.occurredAt,
        },
      });
    }
    const stored = await this.transaction.inventoryIdentity.findUnique({ where: { uid: state.uid } });
    if (!stored) throw new Error("INVENTORY_IDENTITY_NOT_FOUND");
    return toState(stored);
  }
}
