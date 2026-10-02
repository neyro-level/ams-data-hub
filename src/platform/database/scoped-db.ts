import type { DatabaseTransaction } from "./transaction.ts";

export interface TenantScope {
  organizationId: string;
}

export interface ScopedDb extends TenantScope {
  transaction: DatabaseTransaction;
}

export function createScopedDb(
  scope: TenantScope,
  transaction: DatabaseTransaction,
): ScopedDb {
  if (!scope.organizationId) {
    throw new Error("TENANT_SCOPE_REQUIRED");
  }
  return { organizationId: scope.organizationId, transaction };
}

export function assertScopedOrganization(
  scopedDb: ScopedDb,
  organizationId: string,
): void {
  if (scopedDb.organizationId !== organizationId) {
    throw new Error("CROSS_TENANT_ACCESS_DENIED");
  }
}
