export const TENANT_OWNED_MODELS = [
  "Organization",
  "Member",
  "Project",
  "ProjectMember",
  "Notification",
  "NotificationRead",
  "AuditEvent",
  "IdempotencyKey",
  "OutboxEvent",
  "JobRun",
  "PublicUrlIdReservation",
  "MediaAsset",
  "ProjectCatalogSubscription",
  "ProjectCatalogSubscriptionCity",
  "ProjectCatalogSubscriptionSelection",
  "ProjectPublicContact",
  "EntityEditorial",
  "EntityMediaOrderPolicy",
  "ProjectUrlPolicy",
  "ProjectUrlEntry",
  "ProjectRedirect",
  "ProjectUrlTombstone",
  "Source",
  "SourceCredentialRef",
  "SourceManualRunRequest",
  "Agent",
  "AgentExternalIdentity",
  "AgentMatchReview",
  "AgentMergeEvent",
  "AgentConsentBatch",
  "ProjectCurrentSnapshotManifest",
  "DeliveryRun",
  "ProjectAckCredential",
] as const;

export type TenantOwnedModel = (typeof TENANT_OWNED_MODELS)[number];

export function isTenantOwnedModel(model: string): model is TenantOwnedModel {
  return TENANT_OWNED_MODELS.some((candidate) => candidate === model);
}
