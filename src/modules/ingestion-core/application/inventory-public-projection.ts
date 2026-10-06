import { inventoryEntitySchema, mediaPublicV1Schema, type InventoryEntity, type MediaPublicV1 } from "@ams-data-hub/realty-contracts";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import type { InventoryMediaProjectionInput, InventoryMediaProjectionResult } from "../../media-assets/index.ts";
import { toPublicInventoryDto } from "../domain/canonical-inventory.ts";

export interface InventoryPublicProjectionDependencies {
  projectMedia(principal: PrincipalContext, input: InventoryMediaProjectionInput): Promise<InventoryMediaProjectionResult>;
}

/** Input facts must be server-owned persisted canonical facts, not request JSON.
 * A hash pin binds versions; it is not a substitute for trusted fact loading. */
export function createInventoryPublicProjectionService(dependencies: InventoryPublicProjectionDependencies) {
  return async function projectInventory(principal: PrincipalContext, input: { entity: InventoryEntity; sourceRevisionId: string }) {
    const entity = inventoryEntitySchema.parse(input.entity);
    const projection = await dependencies.projectMedia(principal, {
      organizationId: entity.organizationId, projectId: entity.projectId, sourceId: entity.sourceId,
      inventoryUid: entity.uid, sourceRevisionId: input.sourceRevisionId, expectedRecordHash: entity.normalizedHash,
    });
    const ordered = projection.media.map((item) => mediaPublicV1Schema.parse(item)).sort((a, b) =>
      a.position - b.position || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
    const media: MediaPublicV1[] = [];
    const warnings: (InventoryMediaProjectionResult["warnings"][number] | "MEDIA_RELATION_AMBIGUOUS")[] = [...projection.warnings];
    const positions = new Map<number, MediaPublicV1[]>();
    for (const item of ordered) positions.set(item.position, [...(positions.get(item.position) ?? []), item]);
    for (const items of positions.values()) {
      const first = items[0]!;
      if (items.some((item) => item.ref !== first.ref || JSON.stringify(item) !== JSON.stringify(first))) {
        warnings.push("MEDIA_RELATION_AMBIGUOUS"); continue;
      }
      media.push(first);
    }
    return { inventory: toPublicInventoryDto(entity, media), warnings };
  };
}
