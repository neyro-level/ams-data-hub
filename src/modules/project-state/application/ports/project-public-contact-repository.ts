import type { ReplaceProjectPublicContactInput } from "../../contracts.ts";

export interface StoredProjectPublicContact {
  phone: string;
  email: string | null;
  addressPublic: string | null;
  messengers: string[];
  hours: string | null;
  version: number;
}

export interface ProjectPublicContactAuditInput {
  organizationId: string;
  projectId: string;
  actorId: string;
  correlationId: string;
  beforeMarker: ContactPresenceMarker | null;
  afterMarker: ContactPresenceMarker;
}

export interface ContactPresenceMarker {
  hasEmail: boolean;
  hasAddress: boolean;
  messengerCount: number;
  hasHours: boolean;
  version: number;
}

export interface ProjectPublicContactRepository {
  projectExists(organizationId: string, projectId: string): Promise<boolean>;
  find(organizationId: string, projectId: string): Promise<StoredProjectPublicContact | null>;
  replace(input: ReplaceProjectPublicContactInput): Promise<number | null>;
  appendAudit(input: ProjectPublicContactAuditInput): Promise<void>;
}
