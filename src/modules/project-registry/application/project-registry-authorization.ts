import type { PrincipalContext, PlatformAdminPrincipal } from "../../../platform/authorization/principal.ts";
import { ProjectRegistryError } from "../domain/project-registry-error.ts";

export function requireProjectRegistryAdmin(
  principal: PrincipalContext,
): PlatformAdminPrincipal {
  if (principal.kind !== "platform-admin") {
    throw new ProjectRegistryError("PROJECT_REGISTRY_ADMIN_ACCESS_DENIED");
  }
  return principal;
}
