import { describe, expect, it } from "vitest";
import {
  getPrincipalPermissions,
  hasPermission,
  type PrincipalContext,
} from "../src/platform/authorization/principal.ts";

describe("principal permissions", () => {
  it("gives platform admin full Data Hub permissions", () => {
    const principal: PrincipalContext = {
      kind: "platform-admin",
      userId: "user-1",
      correlationId: "corr-1",
    };

    expect(hasPermission(principal, "platform:manage")).toBe(true);
    expect(hasPermission(principal, "project:manage:any")).toBe(true);
  });

  it("keeps organization editor scoped to organization reads", () => {
    const principal: PrincipalContext = {
      kind: "tenant-user",
      userId: "user-2",
      organizationId: "org-1",
      membershipId: "member-2",
      role: "ORG_EDITOR",
      correlationId: "corr-2",
    };

    expect(getPrincipalPermissions(principal)).toContain("project:read:organization");
    expect(hasPermission(principal, "platform:manage")).toBe(false);
  });

  it("keeps members scoped to organization reads", () => {
    const principal: PrincipalContext = {
      kind: "tenant-user",
      userId: "user-3",
      organizationId: "org-1",
      membershipId: "member-1",
      role: "ORG_VIEWER",
      correlationId: "corr-3",
    };

    expect(hasPermission(principal, "project:read:organization")).toBe(true);
    expect(hasPermission(principal, "project:read:any")).toBe(false);
  });
});
