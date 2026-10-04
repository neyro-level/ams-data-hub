import type {
  EditorialFaqItem,
  ProjectEditorialKey,
  ReplaceEntityEditorialInput,
  ReplaceEntityMediaOrderPolicyInput,
} from "../../contracts.ts";

export interface StoredEntityEditorial extends ProjectEditorialKey {
  shortDescription: string | null;
  description: string | null;
  faq: EditorialFaqItem[];
  presentationNotes: string | null;
  mediaOrder: string[];
  mediaOrderPolicyVersion: number | null;
  version: number;
}

export interface StoredEntityMediaOrderPolicy extends ProjectEditorialKey {
  sourceMediaOrder: string[];
  isImageOrderChangeAllowed: boolean;
  version: number;
}

export interface EditorialAuditInput {
  organizationId: string;
  projectId: string;
  entityType: ProjectEditorialKey["entityType"];
  entityUid: string;
  actorType: "USER" | "SYSTEM";
  actorId: string;
  correlationId: string;
  action: "entity-editorial.replace" | "entity-media-order-policy.replace";
  beforeMarker: Record<string, string | number | boolean> | null;
  afterMarker: Record<string, string | number | boolean>;
}

export interface EntityEditorialRepository {
  projectExists(organizationId: string, projectId: string): Promise<boolean>;
  findEditorial(key: ProjectEditorialKey): Promise<StoredEntityEditorial | null>;
  findPolicy(key: ProjectEditorialKey): Promise<StoredEntityMediaOrderPolicy | null>;
  replaceEditorial(input: ReplaceEntityEditorialInput, mediaOrderPolicyVersion: number | null): Promise<number | null>;
  replacePolicy(input: ReplaceEntityMediaOrderPolicyInput): Promise<{ version: number; overrideCleared: boolean } | null>;
  appendAudit(input: EditorialAuditInput): Promise<void>;
}
