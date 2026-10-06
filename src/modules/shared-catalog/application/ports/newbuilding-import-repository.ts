import type { NewbuildingCurrentState, NewbuildingStagingPayload } from "../../domain/newbuilding-import.ts";

export interface NewbuildingImportScope {
  organizationId: string;
  projectId: string;
}

export interface NewbuildingImportState extends NewbuildingCurrentState {
  version: number;
}

export interface NewbuildingImportRepository {
  read(scope: NewbuildingImportScope, payload: NewbuildingStagingPayload): Promise<NewbuildingImportState>;
  apply(scope: NewbuildingImportScope, payload: NewbuildingStagingPayload, state: NewbuildingImportState): Promise<{ uid: string; version: number }>;
  appendAudit(scope: NewbuildingImportScope, actorId: string, correlationId: string, result: { uid: string; version: number }): Promise<void>;
}
