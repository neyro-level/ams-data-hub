import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { IdentityAdminError } from "../domain/admin-identity.ts";

export interface IdentityAdminScope {
  actorId: string;
  correlationId: string;
  organizationId: string;
}

export interface IdentityAdminActor {
  actorId: string;
  correlationId: string;
}

export function requireIdentityAdminActor(
  principal: PrincipalContext,
): IdentityAdminActor {
  if (principal.kind !== "platform-admin") {
    throw new IdentityAdminError("IDENTITY_ADMIN_ACCESS_DENIED");
  }

  return {
    actorId: principal.userId,
    correlationId: principal.correlationId,
  };
}

export function requireIdentityAdminScope(
  principal: PrincipalContext,
  organizationId: string,
): IdentityAdminScope {
  if (principal.kind !== "platform-admin") {
    throw new IdentityAdminError("IDENTITY_ADMIN_ACCESS_DENIED");
  }

  return {
    actorId: principal.userId,
    correlationId: principal.correlationId,
    organizationId,
  };
}
