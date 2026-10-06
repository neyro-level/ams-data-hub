import type { InventoryMediaProjectionInput, MediaAssetRecord } from "../../contracts.ts";

export interface InventoryMediaProjectionState {
  images: readonly { sourceUrl: string; position: number }[];
  relations: readonly {
    id: string;
    canonicalSourceUrl: string;
    position: number;
    status: "MIRRORED" | "WARNING";
    mirroredAt: Date | null;
    asset: MediaAssetRecord | null;
  }[];
}
export interface MediaProjectionRepository {
  loadInventory(input: InventoryMediaProjectionInput): Promise<InventoryMediaProjectionState | null>;
}
