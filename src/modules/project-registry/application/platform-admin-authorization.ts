import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { ProjectRegistryAdminError } from "../domain/platform-admin.ts";

export interface PlatformAdminActorScope {
  actorId: string;
  correlationId: string;
}

export interface ProjectRegistryManagementScope extends PlatformAdminActorScope {
  organizationId: string;
}

export function requireProjectRegistryAdminActor(
  principal: PrincipalContext,
): PlatformAdminActorScope {
  if (principal.kind !== "platform-admin") {
    throw new ProjectRegistryAdminError("PROJECT_REGISTRY_ADMIN_ACCESS_DENIED");
  }
  return {
    actorId: principal.userId,
    correlationId: principal.correlationId,
  };
}

export function requireProjectRegistryManagementScope(
  principal: PrincipalContext,
  organizationId: string,
): ProjectRegistryManagementScope {
  const actor = requireProjectRegistryAdminActor(principal);
  return {
    ...actor,
    organizationId,
  };
}

export function requireProjectRegistryReadScope(principal: PrincipalContext) {
  requireProjectRegistryAdminActor(principal);
  return { kind: "platform" as const };
}

export function requirePlatformProfileManagement(
  principal: PrincipalContext,
): PlatformAdminActorScope {
  return requireProjectRegistryAdminActor(principal);
}
