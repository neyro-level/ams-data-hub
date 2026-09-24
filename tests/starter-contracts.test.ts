import { describe, expect, it } from "vitest";
import { createProjectInputSchema } from "../src/modules/project-registry/contracts.ts";
import { createUserInputSchema, systemRoleSchema } from "../src/modules/identity-access/contracts.ts";
import { requestMaintenanceInputSchema } from "../src/modules/platform-operations/contracts.ts";

describe("starter admin contracts", () => {
  it("uses neutral system roles", () => {
    expect(systemRoleSchema.options).toEqual(["PLATFORM_ADMIN", "STAFF", "MEMBER"]);
  });

  it("validates project and user inputs", () => {
    expect(createProjectInputSchema.parse({
      organizationId: "org-1",
      slug: "starter",
      name: "Стартовый проект",
    }).status).toBe("ACTIVE");

    expect(createUserInputSchema.parse({
      username: "member_1",
      name: "Member",
      systemRole: "MEMBER",
    }).systemRole).toBe("MEMBER");
  });

  it("keeps maintenance outbox input neutral", () => {
    expect(requestMaintenanceInputSchema.parse({ idempotencyKey: "manual-1" })).toEqual({
      idempotencyKey: "manual-1",
    });
  });
});
