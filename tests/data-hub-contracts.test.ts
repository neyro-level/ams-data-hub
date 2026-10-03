import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createProjectInputSchema } from "../src/modules/project-registry/contracts.ts";
import { createUserInputSchema, systemRoleSchema } from "../src/modules/identity-access/contracts.ts";
import { requestMaintenanceInputSchema } from "../src/modules/platform-operations/contracts.ts";

describe("Data Hub admin contracts", () => {
  it("uses the supported system roles", () => {
    expect(systemRoleSchema.options).toEqual(["PLATFORM_ADMIN", "USER"]);
  });

  it("validates project and user inputs", () => {
    expect(createProjectInputSchema.parse({
      organizationId: "org-1",
      slug: "data-hub",
      name: "Data Hub",
    }).status).toBe("ACTIVE");

    expect(createUserInputSchema.parse({
      username: "member_1",
      name: "Member",
      systemRole: "USER",
    }).systemRole).toBe("USER");
  });

  it("keeps maintenance outbox input domain-agnostic", () => {
    expect(requestMaintenanceInputSchema.parse({ idempotencyKey: "manual-1" })).toEqual({
      idempotencyKey: "manual-1",
    });
  });

  it("keeps approved Task Manager artifacts outside product identity scanning", () => {
    const verifier = readFileSync("scripts/verify-config.mjs", "utf8");
    expect(verifier).toContain('"docs/AMS Data Hub Master Plan v1.md"');
    expect(verifier).toContain('"docs/AMS_DATA_HUB_MASTER_PLAN_V1.inventory.json"');
    expect(verifier).toContain("if (ignoredFiles.has(relativeFile)) continue");
  });
});
