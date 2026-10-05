import { publicUrlIdSchema, ulidSchema } from "@ams-data-hub/data-contracts";
import { z } from "zod";

const identifierSchema = z.string().trim().min(1).max(128);
const textSchema = z.string().trim().min(1).max(500);
const longTextSchema = z.string().max(100_000);
const finiteNumberSchema = z.number().finite();
const nonNegativeNumberSchema = finiteNumberSchema.nonnegative();
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const positiveIntegerSchema = z.number().int().positive();
const booleanSchema = z.boolean();

export const sparseStateSchema = z.enum([
  "ABSENT",
  "EXPLICIT_FALSE",
  "EXPLICIT_ZERO",
  "VALUE",
  "INVALID",
]);

export function sparseValueSchema<TSchema extends z.ZodType>(valueSchema: TSchema) {
  return z.discriminatedUnion("state", [
    z.object({ state: z.literal("ABSENT") }).strict(),
    z.object({ state: z.literal("EXPLICIT_FALSE") }).strict(),
    z.object({ state: z.literal("EXPLICIT_ZERO") }).strict(),
    z.object({ state: z.literal("VALUE"), value: valueSchema }).strict(),
    z.object({
      state: z.literal("INVALID"),
      raw: z.string().max(2_000).optional(),
      reason: z.string().trim().min(1).max(300),
    }).strict(),
  ]);
}

export type SparseValue<TValue> =
  | { state: "ABSENT" }
  | { state: "EXPLICIT_FALSE" }
  | { state: "EXPLICIT_ZERO" }
  | { state: "VALUE"; value: TValue }
  | { state: "INVALID"; raw?: string; reason: string };

const sparseText = sparseValueSchema(textSchema);
const sparseNumber = sparseValueSchema(nonNegativeNumberSchema);
const sparseInteger = sparseValueSchema(nonNegativeIntegerSchema);
const sparsePositiveInteger = sparseValueSchema(positiveIntegerSchema);
const sparseBoolean = sparseValueSchema(booleanSchema);

export const inventoryPropertyTypeSchema = z.enum([
  "APARTMENT",
  "ROOM",
  "HOUSE",
  "HOUSE_PART",
  "LAND",
  "COTTAGE",
  "TOWNHOUSE",
  "GARAGE_BOX",
  "NEW_BUILD_UNIT",
  "COMMERCIAL",
  "OTHER",
]);
export const inventoryTransactionTypeSchema = z.enum(["SALE", "RENT"]);
export const inventoryStatusSchema = z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]);
export const inventoryLocationPrecisionSchema = z.enum(["EXACT", "STREET", "DISTRICT"]);
export const cadastralValidationStatusSchema = z.enum([
  "VALID_FORMAT",
  "INVALID_FORMAT",
  "PLACEHOLDER_SUSPECTED",
  "ABSENT",
]);

export const addressValueSchema = z.object({
  addressPublic: z.string().trim().min(1).max(1_000),
  apartmentNumberPrivate: z.string().trim().min(1).max(100).optional(),
  sourceAddressRaw: z.string().max(2_000).optional(),
}).strict();

export const inventoryGeoSchema = z.object({
  latitude: sparseValueSchema(finiteNumberSchema.min(-90).max(90)),
  longitude: sparseValueSchema(finiteNumberSchema.min(-180).max(180)),
}).strict();

const inventoryMediaSchema = z.object({
  sourceUrl: z.string().url().max(2_000),
  position: nonNegativeIntegerSchema,
}).strict();

const apartmentFactsFields = {
  rooms: sparseInteger,
  roomsType: sparseText,
  totalAreaM2: sparseNumber,
  livingAreaM2: sparseNumber,
  kitchenAreaM2: sparseNumber,
  floor: sparseInteger,
  floorsTotal: sparsePositiveInteger,
  ceilingHeightM: sparseNumber,
  buildingType: sparseText,
  buildingYear: sparsePositiveInteger,
  renovation: sparseText,
  bathroomType: sparseText,
  windowView: sparseText,
  balconyText: sparseText,
  balconies: sparseInteger,
  loggias: sparseInteger,
  heatingSupply: sparseText,
  roomFurniture: sparseText,
  parkingType: sparseText,
  isGroundFloor: sparseBoolean,
  disableFlatPlanGuess: sparseBoolean,
  videoReviewAvailable: sparseBoolean,
  onlineShowAvailable: sparseBoolean,
} as const;

const houseFactsFields = {
  rooms: sparseInteger,
  roomsType: sparseText,
  totalAreaM2: sparseNumber,
  livingAreaM2: sparseNumber,
  kitchenAreaM2: sparseNumber,
  lotAreaM2: sparseNumber,
  floorsTotal: sparsePositiveInteger,
  ceilingHeightM: sparseNumber,
  buildingType: sparseText,
  buildingYear: sparsePositiveInteger,
  renovation: sparseText,
  landPurpose: sparseText,
  lotType: sparseText,
  heatingSupply: sparseText,
  utilities: sparseText,
  parkingType: sparseText,
} as const;

const landFactsFields = {
  lotAreaM2: sparseNumber,
  landPurpose: sparseText,
  lotType: sparseText,
  cadastralNumberRaw: sparseText,
  cadastralNumberNormalized: sparseText,
  cadastralValidationStatus: cadastralValidationStatusSchema,
  utilities: sparseText,
} as const;

const garageFactsFields = {
  totalAreaM2: sparseNumber,
  garageType: sparseText,
  buildingType: sparseText,
  electricityAvailable: sparseBoolean,
} as const;

const commercialFactsFields = {
  totalAreaM2: sparseNumber,
  floor: sparseInteger,
  floorsTotal: sparsePositiveInteger,
  commercialUse: sparseText,
} as const;

const reservedFactsFields = {
  totalAreaM2: sparseNumber,
  sourceCategory: sparseText,
} as const;

function inventoryVariant<const TPropertyType extends z.infer<typeof inventoryPropertyTypeSchema>>(
  propertyType: TPropertyType,
  facts: z.ZodType,
) {
  return z.object({ propertyType: z.literal(propertyType), facts }).strict();
}

export const inventoryFactsByPropertySchema = z.discriminatedUnion("propertyType", [
  inventoryVariant("APARTMENT", z.object(apartmentFactsFields).strict()),
  inventoryVariant("ROOM", z.object(apartmentFactsFields).strict()),
  inventoryVariant("HOUSE", z.object(houseFactsFields).strict()),
  inventoryVariant("HOUSE_PART", z.object(houseFactsFields).strict()),
  inventoryVariant("LAND", z.object(landFactsFields).strict()),
  inventoryVariant("COTTAGE", z.object(houseFactsFields).strict()),
  inventoryVariant("TOWNHOUSE", z.object(houseFactsFields).strict()),
  inventoryVariant("GARAGE_BOX", z.object(garageFactsFields).strict()),
  inventoryVariant("NEW_BUILD_UNIT", z.object(apartmentFactsFields).strict()),
  inventoryVariant("COMMERCIAL", z.object(commercialFactsFields).strict()),
  inventoryVariant("OTHER", z.object(reservedFactsFields).strict()),
]);

const inventoryBaseSchema = z.object({
  id: identifierSchema,
  uid: ulidSchema,
  publicUrlId: publicUrlIdSchema,
  organizationId: identifierSchema,
  projectId: identifierSchema,
  sourceId: identifierSchema,
  externalId: identifierSchema,
  transactionType: inventoryTransactionTypeSchema,
  dealKind: z.string().trim().min(1).max(64).optional(),
  status: inventoryStatusSchema,
  sourceCreatedAt: z.iso.datetime({ offset: false }).optional(),
  sourceUpdatedAt: z.iso.datetime({ offset: false }).optional(),
  firstSeenAt: z.iso.datetime({ offset: false }),
  lastSeenAt: z.iso.datetime({ offset: false }),
  title: textSchema.optional(),
  descriptionHtmlSafe: longTextSchema.optional(),
  descriptionText: longTextSchema.optional(),
  sourceObjectCode: z.string().trim().min(1).max(200).optional(),
  price: nonNegativeNumberSchema.optional(),
  currency: z.string().regex(/^[A-Z]{3}$/u).optional(),
  rentPeriod: z.enum(["DAY", "MONTH", "YEAR"]).optional(),
  address: addressValueSchema,
  geo: inventoryGeoSchema,
  locationPrecision: inventoryLocationPrecisionSchema,
  agentUid: ulidSchema.optional(),
  media: z.array(inventoryMediaSchema).max(500),
  isImageOrderChangeAllowed: z.boolean().optional(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/u),
  normalizedHash: z.string().regex(/^[a-f0-9]{64}$/u),
  createdAt: z.iso.datetime({ offset: false }),
  updatedAt: z.iso.datetime({ offset: false }),
}).strict();

export const inventoryEntitySchema = z.intersection(inventoryBaseSchema, inventoryFactsByPropertySchema);
export type InventoryEntity = z.infer<typeof inventoryEntitySchema>;
export type AddressValue = z.infer<typeof addressValueSchema>;

const publicInventoryBaseSchema = inventoryBaseSchema.omit({
  id: true,
  organizationId: true,
  projectId: true,
  sourceId: true,
  externalId: true,
  sourceObjectCode: true,
  sourceHash: true,
  normalizedHash: true,
}).extend({
  address: z.object({ addressPublic: addressValueSchema.shape.addressPublic }).strict(),
}).strict();

export const publicInventoryDtoSchema = z.intersection(publicInventoryBaseSchema, inventoryFactsByPropertySchema);
export type PublicInventoryDto = z.infer<typeof publicInventoryDtoSchema>;
