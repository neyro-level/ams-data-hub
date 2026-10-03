import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { PrismaIdentityAdminRepository } from "../src/modules/identity-access/infrastructure/prisma-identity-admin-repository.ts";
import { createProjectInputSchema } from "../src/modules/project-registry/contracts.ts";

describe("DH01.6 Hub Admin controls", () => {
  it("preserves the project service lifecycle and operational metadata", () => {
    expect(createProjectInputSchema.parse({
      organizationId: "org-1",
      slug: "analytics",
      name: "Analytics",
      serviceState: "SUSPENDED",
      siteBaseUrl: "https://analytics.example.test",
      publicUrlPolicyVersion: "v2",
      notes: "Paused by owner decision",
    })).toMatchObject({
      serviceState: "SUSPENDED",
      siteBaseUrl: "https://analytics.example.test",
      publicUrlPolicyVersion: "v2",
      notes: "Paused by owner decision",
    });
  });

  it("returns projects on organization cards", async () => {
    const findMany = vi.fn().mockResolvedValue([{
      id: "org-1",
      slug: "ams",
      name: "AMS",
      version: 1,
      updatedAt: new Date("2026-10-03T00:00:00.000Z"),
      _count: { members: 2, projects: 1 },
      projects: [{ id: "project-1", name: "Data Hub", slug: "data-hub", serviceState: "ACTIVE" }],
    }]);
    const repository = new PrismaIdentityAdminRepository({
      organization: { count: vi.fn().mockResolvedValue(1), findMany },
    } as never);

    await expect(repository.listOrganizations({
      page: 1,
      pageSize: 20,
      search: "",
      sort: "updatedAt",
      direction: "desc",
    })).resolves.toMatchObject({
      items: [{
        projectCount: 1,
        projects: [{ id: "project-1", serviceState: "ACTIVE" }],
      }],
    });
  });

  it("keeps writes audited and hides client role controls when the feature is disabled", () => {
    const projectCommands = readFileSync("src/modules/project-registry/application/project-registry-commands.ts", "utf8");
    const identityCommands = readFileSync("src/modules/identity-access/application/identity-admin-commands.ts", "utf8");
    const membershipForms = readFileSync("src/app/admin/_components/MembershipAdminForms.tsx", "utf8");
    const userForms = readFileSync("src/app/admin/_components/UserAdminForms.tsx", "utf8");
    const identityActions = readFileSync("src/app/admin/_actions/identity.ts", "utf8");

    expect(projectCommands).toContain("repository.appendAudit");
    expect(identityCommands).toContain("repository.appendAudit");
    expect(membershipForms).toContain("CLIENT_ACCESS_ENABLED=false");
    expect(membershipForms).toContain("EnabledMembershipsAdminForms");
    expect(userForms).toContain("option.value === \"PLATFORM_ADMIN\"");
    expect(identityActions).toContain("requireClientAccess()");
    expect(identityActions).toContain("input.systemRole === \"USER\"");
  });
});
