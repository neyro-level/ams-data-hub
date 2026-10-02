import { describe, expect, it } from "vitest";
import {
  getPrincipalPermissions,
  hasPermission,
  type PrincipalContext,
} from "../src/platform/authorization/principal.ts";

describe("neutral principal permissions", () => {
  it("gives platform admin full starter permissions", () => {
    const principal: PrincipalContext = {
      kind: "platform-admin",
      userId: "user-1",
      correlationId: "corr-1",
    };

    expect(hasPermission(principal, "platform:manage")).toBe(true);
    expect(hasPermission(principal, "project:manage:any")).toBe(true);
  });

  it("keeps staff read-oriented", () => {
    const principal: PrincipalContext = {
      kind: "platform-staff",
      userId: "user-2",
      correlationId: "corr-2",
    };

    expect(getPrincipalPermissions(principal)).toContain("project:read:any");
    expect(hasPermission(principal, "platform:manage")).toBe(false);
  });

  it("keeps members scoped to organization reads", () => {
    const principal: PrincipalContext = {
      kind: "tenant-user",
      userId: "user-3",
      organizationId: "org-1",
      membershipId: "member-1",
      role: "VIEWER",
      correlationId: "corr-3",
    };

    expect(hasPermission(principal, "project:read:organization")).toBe(true);
    expect(hasPermission(principal, "project:read:any")).toBe(false);
  });
});
