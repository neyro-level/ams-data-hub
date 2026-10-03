import type {
  CreateBuildingInput,
  CreateDeveloperInput,
  CreateDevelopmentInput,
  MergeSharedCatalogEntityInput,
  RelinkSharedCatalogEntityInput,
  UpdateBuildingInput,
  UpdateDeveloperInput,
  UpdateDevelopmentInput,
} from "../../contracts.ts";

export interface CatalogWriteResult {
  uid: string;
  version: number;
}

export interface CatalogAuditInput {
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeMarker: Record<string, string | number | boolean | null> | null;
  afterMarker: Record<string, string | number | boolean | null> | null;
  correlationId: string;
}

export interface SharedCatalogRepository {
  createDeveloper(input: CreateDeveloperInput & { uid: string; normalizedName: string; normalizedAliases: string[] }): Promise<CatalogWriteResult>;
  updateDeveloper(input: UpdateDeveloperInput & { normalizedName: string; normalizedAliases: string[] }): Promise<CatalogWriteResult | null>;
  createDevelopment(input: CreateDevelopmentInput & { uid: string; normalizedName: string; normalizedAliases: string[] }): Promise<CatalogWriteResult>;
  updateDevelopment(input: UpdateDevelopmentInput & { normalizedName: string; normalizedAliases: string[] }): Promise<CatalogWriteResult | null>;
  createBuilding(input: CreateBuildingInput & { uid: string; normalizedLabel: string; normalizedAliases: string[] }): Promise<CatalogWriteResult>;
  updateBuilding(input: UpdateBuildingInput & { normalizedLabel: string; normalizedAliases: string[] }): Promise<CatalogWriteResult | null>;
  merge(input: MergeSharedCatalogEntityInput): Promise<CatalogWriteResult | null>;
  relink(input: RelinkSharedCatalogEntityInput): Promise<CatalogWriteResult | null>;
  appendAudit(input: CatalogAuditInput): Promise<void>;
}
