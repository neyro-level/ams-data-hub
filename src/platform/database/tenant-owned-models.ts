export const TENANT_OWNED_MODELS = [
  "Project",
  "AuditEvent",
  "IdempotencyKey",
  "OutboxEvent",
  "JobRun",
  "Notification",
] as const;

export type TenantOwnedModel = (typeof TENANT_OWNED_MODELS)[number];

export function isTenantOwnedModel(model: string): model is TenantOwnedModel {
  return TENANT_OWNED_MODELS.some((candidate) => candidate === model);
}
