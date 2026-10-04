import type { ReplaceProjectCatalogSubscriptionInput } from "../../contracts.ts";

export interface CatalogSubscriptionState {
  mode: "ALL_SHARED" | "CURATED";
  version: number;
  cityUids: string[];
  selections: Array<{ developmentUid: string; decision: "INCLUDE" | "EXCLUDE" }>;
}

export interface CatalogSubscriptionAuditInput {
  organizationId: string;
  projectId: string;
  actorId: string;
  correlationId: string;
  beforeMarker: CatalogSubscriptionState | null;
  afterMarker: CatalogSubscriptionState;
}

export interface CatalogSubscriptionRepository {
  projectExists(organizationId: string, projectId: string): Promise<boolean>;
  findSubscription(organizationId: string, projectId: string): Promise<CatalogSubscriptionState | null>;
  countCities(cityUids: string[]): Promise<number>;
  countDevelopments(developmentUids: string[]): Promise<number>;
  replaceSubscription(input: ReplaceProjectCatalogSubscriptionInput): Promise<number | null>;
  appendAudit(input: CatalogSubscriptionAuditInput): Promise<void>;
}
