import { inventoryEntitySchema, type InventoryEntity } from "@ams-data-hub/realty-contracts";

/** Synthetic canonical facts for boundary tests, never an application loader. */
export function syntheticCanonicalInventory(overrides: Partial<InventoryEntity> = {}): InventoryEntity {
  const facts = Object.fromEntries([
    "rooms", "roomsType", "totalAreaM2", "livingAreaM2", "kitchenAreaM2", "floor", "floorsTotal", "ceilingHeightM",
    "buildingType", "buildingYear", "renovation", "bathroomType", "windowView", "balconyText", "balconies", "loggias",
    "heatingSupply", "roomFurniture", "parkingType", "isGroundFloor", "disableFlatPlanGuess", "videoReviewAvailable", "onlineShowAvailable",
  ].map((key) => [key, { state: "ABSENT" }]));
  return inventoryEntitySchema.parse({
    id: "synthetic-row", uid: "01J9ZK8G7Q5X6NP3V4A2B1C0DE", publicUrlId: "01j9zk8g7q5x6np3",
    organizationId: "org", projectId: "project", sourceId: "source", externalId: "one",
    propertyType: "APARTMENT", facts, transactionType: "SALE", status: "ACTIVE",
    firstSeenAt: "2026-10-06T00:00:00.000Z", lastSeenAt: "2026-10-06T00:00:00.000Z",
    title: "Синтетическая квартира", price: 1000, currency: "RUB", address: { addressPublic: "Синтетический город" },
    geo: { latitude: { state: "ABSENT" }, longitude: { state: "ABSENT" } }, locationPrecision: "STREET",
    media: [{ sourceUrl: "https://producer.example.invalid/private.png?token=synthetic", position: 0 }],
    sourceHash: "a".repeat(64), normalizedHash: "b".repeat(64),
    createdAt: "2026-10-06T00:00:00.000Z", updatedAt: "2026-10-06T00:00:00.000Z", ...overrides,
  });
}
