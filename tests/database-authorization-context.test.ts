import { describe, expect, it } from "vitest";
import type { PlatformAdminPrincipal, TenantUserPrincipal } from "../src/platform/authorization/principal.ts";
import { createProjectDatabaseAuthorizationContext } from "../src/platform/database/transaction.ts";

describe("project database authorization context", () => {
  const tenant: TenantUserPrincipal = {
    kind: "tenant-user",
    userId: "user-1",
    organizationId: "org-1",
    membershipId: "member-1",
    role: "ORG_EDITOR",
    projectIds: ["project-1", "project-2"],
    correlationId: "correlation-1",
  };

  it("narrows an allowed tenant context to the requested project", () => {
    expect(createProjectDatabaseAuthorizationContext(tenant, "project-2").projectIds)
      .toEqual(["project-2"]);
  });

  it("does not elevate a tenant into an unassigned project", () => {
    expect(createProjectDatabaseAuthorizationContext(tenant, "project-3").projectIds)
      .toEqual([]);
  });

  it("narrows platform-wide access to the requested project", () => {
    const admin: PlatformAdminPrincipal = {
      kind: "platform-admin",
      userId: "admin-1",
      correlationId: "correlation-2",
    };
    expect(createProjectDatabaseAuthorizationContext(admin, "project-3").projectIds)
      .toEqual(["project-3"]);
  });
});
