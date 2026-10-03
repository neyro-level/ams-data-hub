import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { PrismaIdentityAdminRepository } from "../src/modules/identity-access/infrastructure/prisma-identity-admin-repository.ts";
import { PrismaProjectRegistryRepository } from "../src/modules/project-registry/infrastructure/prisma-project-registry-repository.ts";
import { resolveTenantMembership } from "../src/platform/authorization/principal-factories.ts";
import { collectDatabasePages } from "../src/platform/database/collect-pages.ts";
import type { DatabaseTransaction } from "../src/platform/database/transaction.ts";

describe("DH01.5 defect regressions", () => {
  it("B5 reads every database page instead of truncating at 100 rows", async () => {
    const source = Array.from({ length: 205 }, (_, index) => index);
    const readPage = vi.fn(({ skip, take }: { skip: number; take: number }) =>
      Promise.resolve(source.slice(skip, skip + take)));

    await expect(collectDatabasePages(readPage)).resolves.toEqual(source);
    expect(readPage.mock.calls.map(([pagination]) => pagination)).toEqual([
      { skip: 0, take: 100 },
      { skip: 100, take: 100 },
      { skip: 200, take: 100 },
    ]);
  });

  it("B5 paginates project trees and identity form options", async () => {
    const projectFindMany = vi.fn()
      .mockResolvedValueOnce(Array.from({ length: 100 }, (_, index) => ({ id: `p-${index}` })))
      .mockResolvedValueOnce([{ id: "p-100" }]);
    const projectRepository = new PrismaProjectRegistryRepository({
      project: { findMany: projectFindMany },
    } as unknown as DatabaseTransaction);

    await expect(projectRepository.listProjectTrees()).resolves.toHaveLength(101);
    expect(projectFindMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ skip: 100, take: 100 }));

    const organizationFindMany = vi.fn()
      .mockResolvedValueOnce(Array.from({ length: 100 }, (_, index) => ({ id: `o-${index}`, name: `Org ${index}` })))
      .mockResolvedValueOnce([{ id: "o-100", name: "Org 100" }]);
    const userFindMany = vi.fn().mockResolvedValue([]);
    const identityRepository = new PrismaIdentityAdminRepository({
      organization: { findMany: organizationFindMany },
      user: { findMany: userFindMany },
    } as never);

    await expect(identityRepository.listFormOptions()).resolves.toMatchObject({
      organizations: { length: 101 },
      users: [],
    });
    expect(organizationFindMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ skip: 100, take: 100 }));
  });

  it("B6 auto-selects one membership and requires an explicit choice for several", () => {
    const memberships = [
      { organizationId: "org-a" },
      { organizationId: "org-b" },
    ];

    expect(resolveTenantMembership([memberships[0]], null)).toEqual(memberships[0]);
    expect(resolveTenantMembership([memberships[0]], "removed-org")).toEqual(memberships[0]);
    expect(resolveTenantMembership(memberships, null)).toBeNull();
    expect(resolveTenantMembership(memberships, "org-b")).toEqual(memberships[1]);

    const selectionPage = readFileSync("src/app/organization/page.tsx", "utf8");
    expect(selectionPage).toContain("Выберите организацию");
    expect(selectionPage).toContain("selectOrganizationAction");
  });

  it("B7 scopes action lookup by server-owned organization and project IDs", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const repository = new PrismaProjectRegistryRepository({
      project: { findFirst },
    } as unknown as DatabaseTransaction);

    await repository.findProjectForAction({ organizationId: "org-a", projectId: "project-a" });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "project-a", organizationId: "org-a" },
    }));
  });

  it("B8 generates request correlation IDs instead of exposing session IDs", () => {
    const source = readFileSync("src/platform/auth/principal-session.ts", "utf8");
    expect(source).toContain("const correlationId = createCorrelationId()");
    expect(source).not.toMatch(/correlationId:\s*`[^`]*session\.session\.id/);
    expect(source).not.toMatch(/const correlationId\s*=\s*`[^`]*session\.session\.id/);
  });

  it("B9 keeps Better Auth behind the lazy getAuth boundary", () => {
    const source = readFileSync("src/platform/auth/auth.ts", "utf8");
    expect(source).toContain("let initializedAuth:");
    expect(source).toContain("export function getAuth()");
    expect(source).not.toMatch(/export const auth\s*=\s*betterAuth/);
  });
});
