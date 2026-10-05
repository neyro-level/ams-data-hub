import type { InventoryIdentityState, InventoryLifecycleEventType } from "../../domain/inventory-lifecycle.ts";

export interface InventoryIdentityKey {
  organizationId: string;
  projectId: string;
  sourceId: string;
  externalOfferId: string;
}

export interface InventoryIdentityRepository {
  find(key: InventoryIdentityKey): Promise<InventoryIdentityState | null>;
  save(input: {
    state: InventoryIdentityState;
    expectedVersion: number | null;
    event: InventoryLifecycleEventType | null;
    occurredAt: Date;
  }): Promise<InventoryIdentityState>;
}
