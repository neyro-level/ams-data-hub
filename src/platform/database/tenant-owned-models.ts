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
] as const;

export type TenantOwnedModel = (typeof TENANT_OWNED_MODELS)[number];

export function isTenantOwnedModel(model: string): model is TenantOwnedModel {
  return TENANT_OWNED_MODELS.some((candidate) => candidate === model);
}
