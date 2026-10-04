import type { PlatformAdminPrincipal, PrincipalContext } from "../../../platform/authorization/principal.ts";
import { SourceRegistryError } from "../domain/source-registry-error.ts";

export function requireSourceRegistryAdmin(principal: PrincipalContext): PlatformAdminPrincipal {
  if (principal.kind !== "platform-admin") throw new SourceRegistryError("SOURCE_REGISTRY_ADMIN_ACCESS_DENIED");
  return principal;
}
