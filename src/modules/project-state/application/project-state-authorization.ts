import type { PlatformAdminPrincipal, PrincipalContext } from "../../../platform/authorization/principal.ts";
import { ProjectStateError } from "../domain/project-state-error.ts";

export function requireProjectStateAdmin(principal: PrincipalContext): PlatformAdminPrincipal {
  if (principal.kind !== "platform-admin") throw new ProjectStateError("PROJECT_STATE_ADMIN_ACCESS_DENIED");
  return principal;
}

export function requireProjectContactReader(principal: PrincipalContext, organizationId: string): void {
  if (principal.kind === "platform-admin") return;
  if (principal.organizationId !== organizationId) {
    throw new ProjectStateError("PROJECT_PUBLIC_CONTACT_ACCESS_DENIED");
  }
}
