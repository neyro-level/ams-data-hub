import { serializePublicDto, type CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { DESCRIPTION_HTML_SAFE_TAGS, inventoryEntitySchema, inventoryFactsByPropertySchema,
  type MediaPublicV1 } from "@ams-data-hub/realty-contracts";
import sanitizeHtml from "sanitize-html";
import { z } from "zod";
import { normalizeDescription, normalizeProfileToken, resolveProfileAlias,
  toPublicInventoryDto, type SourceProfileConfiguration, type SourceFormatContract } from "../../ingestion-core/index.ts";
import type { SnapshotGoodNormalizedFact } from "../../ingestion-core/server.ts";
import type { SnapshotDatasetInput } from "../contracts.ts";
import { assertSnapshotPrivacySafe } from "../domain/privacy-scanner.ts";
import { projectPublicCoordinates } from "../domain/public-coordinates.ts";

/** Captured metadata, not a substitute entity or a live registry lookup. */
export interface SnapshotInventoryProjectionInput {
  fact: SnapshotGoodNormalizedFact;
  profile: SnapshotInventoryProfile;
  identity: { uid: string; sourceId: string; externalOfferId: string; sourceHash: string; normalizedHash: string;
    factProfileIdentity: string; status: string; firstSeenAt: string; lastSeenAt: string;
    sourceCreatedAt: string | null; sourceUpdatedAt: string | null; createdAt: string; updatedAt: string };
  /** Persistent captured URL-entry association; never generated from the UID. */
  url: { entityType: "INVENTORY"; entityUid: string; publicUrlId: string };
  media: readonly MediaPublicV1[];
}
export interface SnapshotInventoryProfile {
  identity: string;
  configuration: Pick<SourceProfileConfiguration, "fieldMappings" | "unitAliases" | "pricePeriodAliases" | "dealStatusAliases" | "locationPolicy"> | null;
  formatContract: Pick<SourceFormatContract, "family"> | null;
}

const absent = () => ({ state: "ABSENT" } as const);
const invalid = () => ({ state: "INVALID", reason: "INVALID_SOURCE_VALUE" } as const);
const numeric = new Set(["rooms", "totalAreaM2", "livingAreaM2", "kitchenAreaM2", "lotAreaM2", "floor",
  "floorsTotal", "ceilingHeightM", "buildingYear"]);
const booleans = new Set(["disableFlatPlanGuess", "videoReviewAvailable", "onlineShowAvailable"]);
const safeText = z.string().trim().min(1).max(500).refine((value) => !/[<>@\p{Cc}\p{Cf}]|https?:\/\/|www\./iu.test(value));
function value(input: unknown, kind: "number" | "boolean" | "text"): unknown {
  if (input === undefined || input === null || input === "") return absent();
  if (input === false || input === "false") return { state: "EXPLICIT_FALSE" };
  if (input === 0 || input === "0") return { state: "EXPLICIT_ZERO" };
  if (kind === "number") {
    if (typeof input !== "number" && !/^\d+(?:[.,]\d+)?$/u.test(String(input).trim())) return invalid();
    const parsed = typeof input === "number" ? input : Number(String(input).replace(",", "."));
    if (parsed === 0) return { state: "EXPLICIT_ZERO" };
    return Number.isFinite(parsed) && parsed >= 0 ? { state: "VALUE", value: parsed } : invalid();
  }
  if (kind === "boolean") return input === true || input === "true" ? { state: "VALUE", value: true } : invalid();
  const parsed = safeText.safeParse(input);
  return parsed.success ? { state: "VALUE", value: parsed.data } : invalid();
}
// Format-only captured profiles use this explicit versioned baseline, not live configuration.
const formatUnitsV1 = [{ source: "кв. м", canonicalUnit: "M2", multiplier: 1 },
  { source: "m2", canonicalUnit: "M2", multiplier: 1 }, { source: "сотка", canonicalUnit: "M2", multiplier: 100 }];
const formatPeriodsV1 = [{ source: "day", target: "DAY" }, { source: "month", target: "MONTH" },
  { source: "year", target: "YEAR" }] as const;

/** Real GOOD-candidate normalization. Missing public readiness data rejects; no invented fallback. */
export function projectSnapshotInventory(scope: { organizationId: string; projectId: string },
  inputs: readonly SnapshotInventoryProjectionInput[]): SnapshotDatasetInput {
  const seen = new Set<string>();
  const records = inputs.map(({ fact, identity, profile, url, media }) => {
    if (identity.uid !== fact.inventoryUid || url.entityType !== "INVENTORY" || url.entityUid !== identity.uid
      || identity.sourceId !== fact.sourceId || identity.externalOfferId !== fact.externalOfferId
      || identity.normalizedHash !== fact.normalizedHash || identity.factProfileIdentity !== fact.factProfileIdentity
      || identity.factProfileIdentity !== profile.identity || seen.has(identity.uid)) throw new Error("SNAPSHOT_INVENTORY_PIN_INVALID");
    seen.add(identity.uid);
    const configuration = profile.configuration;
    const family = fact.draft.sourceFormat === "DOMCLICK_YRL" ? "YRL_2010" : fact.draft.sourceFormat;
    if ((!configuration && !profile.formatContract) || (profile.formatContract && profile.formatContract.family !== family)
      || (configuration && family !== "YRL_2010")) throw new Error("SNAPSHOT_INVENTORY_PROFILE_INVALID");
    if (fact.draft.transactionType === "UNKNOWN" || !fact.addressPublic) throw new Error("SNAPSHOT_INVENTORY_NOT_READY");
    const first = (path: string): string | number | undefined => {
      const values = fact.fieldValues[path] ?? [];
      if (values.length > 1) throw new Error("SNAPSHOT_INVENTORY_FACT_AMBIGUOUS");
      return values[0];
    };
    const fields = family === "AVITO_V3" ? ["Rooms", "Floor", "Floors", "LivingSpace", "KitchenSpace", "LandArea", "LeaseType"]
      : family === "CIAN_V2" ? ["FlatRoomsCount", "FloorNumber", "Building/FloorsCount", "LivingArea", "KitchenArea", "", "RentTerm"]
        : ["rooms", "floor", "floors-total", "living-space/value", "kitchen-space/value", "lot-area/value", "price/@period"];
    const variant = inventoryFactsByPropertySchema.options.find((option) => option.shape.propertyType.value === fact.draft.propertyType)!;
    const factsSchema = variant.shape.facts as z.ZodObject;
    const facts: Record<string, unknown> = Object.fromEntries(Object.keys(factsSchema.shape)
      .map((key) => [key, key === "cadastralValidationStatus" ? "ABSENT" : absent()]));
    const set = (key: string, candidate: unknown) => {
      if (!(key in facts)) return;
      const result = factsSchema.shape[key]!.safeParse(candidate);
      facts[key] = result.success ? result.data : invalid();
    };
    ["rooms", "floor", "floorsTotal"].forEach((key, index) => set(key, value(first(fields[index]!), "number")));
    set("totalAreaM2", value(fact.draft.areaM2, "number"));
    const units = configuration?.unitAliases ?? formatUnitsV1;
    ["livingAreaM2", "kitchenAreaM2", "lotAreaM2"].forEach((key, index) => {
      const raw = first(fields[index + 3]!);
      if (raw === undefined) return;
      // Marketplace scalar area fields are explicitly square metres in this family baseline.
      const unit = family === "YRL_2010" ? first(["living-space/unit", "kitchen-space/unit", "lot-area/unit"][index]!) : "m2";
      const matches = unit === undefined ? [] : units.filter((alias) => alias.canonicalUnit === "M2"
        && normalizeProfileToken(alias.source) === normalizeProfileToken(String(unit)));
      if (matches.length !== 1 || !Number.isFinite(matches[0]!.multiplier) || matches[0]!.multiplier <= 0) { set(key, invalid()); return; }
      const parsed = Number(String(raw).replace(",", "."));
      set(key, value(/^\d+(?:[.,]\d+)?$/u.test(String(raw).trim()) && Number.isFinite(parsed) && parsed >= 0 ? parsed * matches[0]!.multiplier : NaN, "number"));
    });
    for (const mapping of configuration?.fieldMappings ?? []) if (mapping.targetField.startsWith("facts.")) {
      const key = mapping.targetField.slice(6);
      // No unitless height assumption: this profile field has no captured unit companion yet.
      if (key === "ceilingHeightM") { if (first(mapping.sourcePath) !== undefined) set(key, invalid()); continue; }
      set(key, value(first(mapping.sourcePath), numeric.has(key) ? "number" : booleans.has(key) ? "boolean" : "text"));
    }
    const periodRaw = first(fields[6]!);
    const mapped = (target: string) => {
      const mappings = configuration?.fieldMappings.filter((mapping) => mapping.targetField === target) ?? [];
      if (mappings.length > 1) throw new Error("SNAPSHOT_INVENTORY_PROFILE_INVALID");
      return mappings[0] ? first(mappings[0].sourcePath) : undefined;
    };
    const dealRaw = mapped("dealKind");
    const dealKind = dealRaw === undefined ? undefined : resolveProfileAlias(configuration!.dealStatusAliases, String(dealRaw));
    const orderRaw = mapped("isImageOrderChangeAllowed");
    if (orderRaw !== undefined && orderRaw !== "true" && orderRaw !== "false") throw new Error("SNAPSHOT_INVENTORY_FACT_INVALID");
    const rentPeriod = periodRaw === undefined ? undefined : resolveProfileAlias(configuration?.pricePeriodAliases ?? formatPeriodsV1, String(periodRaw));
    if (fact.draft.transactionType !== "SALE" && !rentPeriod) throw new Error("SNAPSHOT_INVENTORY_RENT_PERIOD_UNKNOWN");
    const locationPrecision = configuration ? configuration.locationPolicy.defaultByPropertyType[fact.draft.propertyType] : "STREET";
    if (locationPrecision !== "STREET" || configuration?.locationPolicy.exactEnabled) throw new Error("SNAPSHOT_INVENTORY_LOCATION_POLICY_INVALID");
    const latitude = fact.draft.latitude; const longitude = fact.draft.longitude;
    if ((latitude === undefined) !== (longitude === undefined)) throw new Error("SNAPSHOT_INVENTORY_COORDINATES_INCOMPLETE");
    const coordinates = latitude === undefined || longitude === undefined ? null : projectPublicCoordinates({
      latitude, longitude, entityUid: identity.uid, precision: locationPrecision, policyVersion: `${profile.identity}:inventory-street-v1` });
    let description: ReturnType<typeof normalizeDescription> | undefined;
    if (fact.draft.description !== undefined) {
      const normalized = normalizeDescription(fact.draft.description);
      // Two bounded passes over already validated safe-HTML text tokens, never a regex over raw markup.
      const tokens: string[] = [];
      const options = { allowedTags: [...DESCRIPTION_HTML_SAFE_TAGS], allowedAttributes: {} };
      sanitizeHtml(normalized.descriptionHtmlSafe, { ...options, textFilter: (text) => { tokens.push(text); return text; } });
      // Safe markup may supply the visual separator (br/block boundaries), so
      // accept zero textual whitespace only within this leading fixed prefix.
      const prefix = /^\s*Код\s*объекта:\s*([^\.\r\n]{1,200})\.\s*/u.exec(tokens.join(""));
      let remaining = prefix?.[0].length ?? 0;
      const cleaned = sanitizeHtml(normalized.descriptionHtmlSafe, { ...options, textFilter: (text) => {
        const consumed = Math.min(remaining, text.length); remaining -= consumed; return text.slice(consumed);
      } });
      description = normalizeDescription(cleaned);
      // A prefix split across markup must not silently expose an internal code.
      if (/^\s*Код\s*объекта:/u.test(description.descriptionText)) throw new Error("SNAPSHOT_INVENTORY_DESCRIPTION_NOT_READY");
    }
    const entity = inventoryEntitySchema.parse({ id: identity.uid, uid: identity.uid, publicUrlId: url.publicUrlId,
      organizationId: scope.organizationId, projectId: scope.projectId, sourceId: identity.sourceId, externalId: identity.externalOfferId,
      propertyType: fact.draft.propertyType, facts, transactionType: fact.draft.transactionType === "SALE" ? "SALE" : "RENT",
      ...(dealKind === undefined || dealKind === "UNKNOWN" ? {} : { dealKind }),
      ...(orderRaw === undefined ? {} : { isImageOrderChangeAllowed: orderRaw === "true" }),
      status: identity.status, firstSeenAt: identity.firstSeenAt, lastSeenAt: identity.lastSeenAt,
      ...(identity.sourceCreatedAt === null ? {} : { sourceCreatedAt: identity.sourceCreatedAt }),
      ...(identity.sourceUpdatedAt === null ? {} : { sourceUpdatedAt: identity.sourceUpdatedAt }),
      ...(fact.draft.title === undefined ? {} : { title: fact.draft.title }), ...description,
      ...(fact.draft.price === undefined ? {} : { price: fact.draft.price }),
      ...(fact.draft.currency === undefined ? {} : { currency: fact.draft.currency }),
      ...(rentPeriod === undefined || fact.draft.transactionType === "SALE" ? {} : { rentPeriod }),
      address: { addressPublic: fact.addressPublic }, locationPrecision,
      geo: { latitude: coordinates ? { state: "VALUE", value: coordinates.latitude } : absent(),
        longitude: coordinates ? { state: "VALUE", value: coordinates.longitude } : absent() }, media: [],
      sourceHash: identity.sourceHash, normalizedHash: identity.normalizedHash, createdAt: identity.createdAt, updatedAt: identity.updatedAt });
    const publicValue = JSON.parse(serializePublicDto(toPublicInventoryDto(entity, media))) as CanonicalJsonValue;
    assertSnapshotPrivacySafe(publicValue);
    return { key: identity.uid, value: publicValue, references: [{ kind: "urls" as const, key: `entry:${url.publicUrlId}` },
      ...media.map((item) => ({ kind: "media" as const, key: `INVENTORY/${identity.uid}/${item.position}` }))] };
  });
  return { kind: "inventory", records: records.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0) };
}
