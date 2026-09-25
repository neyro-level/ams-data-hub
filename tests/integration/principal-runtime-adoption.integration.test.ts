import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createOrganization,
  listOrganizations,
} from "../../src/modules/identity-access/server.ts";
import {
  createProject,
  listProjects,
} from "../../src/modules/project-registry/server.ts";
import {
  listOperations,
  requestMaintenance,
} from "../../src/modules/platform-operations/server.ts";
import { getPlatformAdminDashboardSummary } from "../../src/modules/platform-admin/server.ts";
import type { PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";

function platformAdmin(): PlatformAdminPrincipal {
  return {
    kind: "platform-admin",
    userId: `e03-runtime-admin-${randomUUID()}`,
    correlationId: randomUUID(),
  };
}

const firstPage = {
  page: 1,
  pageSize: 20,
  search: "",
  sort: "updatedAt" as const,
  direction: "desc" as const,
};

describe("E03 runtime principal adoption", () => {
  it("keeps identity, project and operations flows inside platform-admin transactions", async () => {
    const principal = platformAdmin();
    const suffix = randomUUID().slice(0, 12);
    const organization = await createOrganization(principal, {
      slug: `e03-runtime-${suffix}`,
      name: `E03 Runtime ${suffix}`,
    });
    const project = await createProject(principal, {
      organizationId: organization.organizationId,
      slug: `e03-runtime-project-${suffix}`,
      name: `E03 Runtime Project ${suffix}`,
      description: "Principal-scoped PostgreSQL integration proof",
      status: "ACTIVE",
    });

    const [organizations, projects, maintenance, operations, summary] = await Promise.all([
      listOrganizations(principal, firstPage),
      listProjects(principal, firstPage),
      requestMaintenance(principal, { idempotencyKey: `e03-maintenance-${suffix}` }),
      listOperations(principal, firstPage),
      getPlatformAdminDashboardSummary(principal),
    ]);

    expect(organizations.items.some((item) => item.id === organization.organizationId)).toBe(true);
    expect(projects.items.some((item) => item.id === project.projectId)).toBe(true);
    expect(maintenance.duplicate).toBe(false);
    expect(operations.total).toBeGreaterThanOrEqual(0);
    expect(summary.organizations).toBeGreaterThanOrEqual(1);
  });
});
