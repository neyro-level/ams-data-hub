import type { PlatformAdminPrincipal, PrincipalContext } from "../../../platform/authorization/principal.ts";
import { SharedCatalogError } from "../domain/shared-catalog-error.ts";

export function requireSharedCatalogAdmin(
  principal: PrincipalContext,
): PlatformAdminPrincipal {
  if (principal.kind !== "platform-admin") {
    throw new SharedCatalogError("SHARED_CATALOG_ADMIN_ACCESS_DENIED");
  }
  return principal;
}
