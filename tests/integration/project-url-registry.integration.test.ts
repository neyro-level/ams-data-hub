import { randomUUID } from "node:crypto";
import { createUlid } from "@ams-data-hub/data-contracts";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { readTestDatabaseTarget } from "../../scripts/verify-test-database-env.mjs";
import { getProjectUrlRegistry, projectUrlRegistryCommands } from "../../src/modules/project-state/server.ts";
import type { PlatformAdminPrincipal, TenantUserPrincipal } from "../../src/platform/authorization/principal.ts";
import { runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";

const target = readTestDatabaseTarget(process.env, { allowApplicationTarget: true });

function admin(): PlatformAdminPrincipal {
  return { kind: "platform-admin", userId: `url-admin-${randomUUID()}`, correlationId: randomUUID() };
}

function tenant(organizationId: string): TenantUserPrincipal {
  return { kind: "tenant-user", userId: `url-tenant-${randomUUID()}`, organizationId, membershipId: `url-member-${randomUUID()}`, role: "ORG_ADMIN", projectIds: "*", correlationId: randomUUID() };
}

describe("project URL registry", () => {
  it("creates an immutable publicUrlId and a permanent 301 on a published slug change", async () => {
    const principal = admin();
    const suffix = randomUUID().slice(0, 8);
    const setup = await runInPrincipalDatabaseTransaction(principal, async (transaction) => {
      const organization = await transaction.organization.create({ data: { name: `URL Org ${suffix}`, slug: `url-org-${suffix}` } });
      const first = await transaction.project.create({ data: { organizationId: organization.id, name: `URL A ${suffix}`, slug: `url-a-${suffix}` } });
      const second = await transaction.project.create({ data: { organizationId: organization.id, name: `URL B ${suffix}`, slug: `url-b-${suffix}` } });
      return { organizationId: organization.id, firstProjectId: first.id, secondProjectId: second.id };
    });
    const scope = { organizationId: setup.organizationId, projectId: setup.firstProjectId };
    await projectUrlRegistryCommands.replaceProjectUrlPolicy(principal, {
      ...scope,
      version: 0,
      policyKey: "site-v1",
      pathTemplates: [{ entityType: "INVENTORY", template: "/offers/{slug}" }],
      reservedNamespaces: ["api", "admin"],
    });
    const created = await projectUrlRegistryCommands.createProjectUrlEntry(principal, {
      ...scope, entityType: "INVENTORY", entityUid: createUlid(), slug: "first", canonicalPath: "/offers/first",
    });
    const published = await projectUrlRegistryCommands.publishProjectUrlEntry(principal, { ...scope, urlEntryId: created.urlEntryId, version: created.version });
    const changed = await projectUrlRegistryCommands.changeProjectUrlPath(principal, {
      ...scope, urlEntryId: created.urlEntryId, version: published.version, slug: "second", canonicalPath: "/offers/second",
    });
    expect(changed.publicUrlId).toBe(created.publicUrlId);

    const registry = await getProjectUrlRegistry(tenant(setup.organizationId), scope);
    expect(registry.entries[0]).toMatchObject({ canonicalPath: "/offers/second", publicUrlId: created.publicUrlId });
    expect(registry.redirects).toEqual([expect.objectContaining({ fromPath: "/offers/first", toPath: "/offers/second", code: 301, reason: "SLUG_CHANGE" })]);
    await expect(projectUrlRegistryCommands.createProjectUrlEntry(principal, {
      ...scope, entityType: "INVENTORY", entityUid: createUlid(), slug: "first-reuse", canonicalPath: "/offers/first",
    })).rejects.toThrow("PROJECT_URL_PATH_CONFLICT");
    await expect(projectUrlRegistryCommands.createProjectUrlEntry(principal, {
      ...scope, entityType: "INVENTORY", entityUid: createUlid(), slug: "admin", canonicalPath: "/admin/offer",
    })).rejects.toThrow("PROJECT_URL_PATH_RESERVED");
    await expect(projectUrlRegistryCommands.replaceProjectUrlPolicy(principal, {
      ...scope, version: 1, policyKey: "site-v2", pathTemplates: [{ entityType: "INVENTORY", template: "/new/{slug}" }], reservedNamespaces: [],
    })).rejects.toThrow("PROJECT_URL_POLICY_IN_USE");
    await expect(getProjectUrlRegistry(tenant(setup.organizationId), { ...scope, projectId: setup.secondProjectId })).resolves.toEqual({ entries: [], redirects: [] });

    const relinked = await projectUrlRegistryCommands.relinkProjectUrlEntry(principal, {
      ...scope, urlEntryId: changed.urlEntryId, version: changed.version, entityType: "INVENTORY", entityUid: createUlid(),
    });
    expect(relinked.publicUrlId).toBe(created.publicUrlId);

    const client = new pg.Client({ host: target.host, port: target.port, database: target.database, user: target.user, password: target.password, ssl: target.sslmode === "require" });
    await client.connect();
    try {
      await client.query("set role ams_data_hub_web");
      await client.query("begin");
      await client.query("select set_config('app.principal_kind', 'platform-admin', true)");
      await expect(client.query('update "PublicUrlIdReservation" set "publicUrlId" = $1 where "publicUrlId" = $2', ["0000000000000000", created.publicUrlId])).rejects.toThrow(/immutable|нет доступа|permission denied/i);
      await client.query("rollback");
      await client.query("begin");
      await client.query("select set_config('app.principal_kind', 'platform-admin', true)");
      await expect(client.query('update "ProjectRedirect" set "toPath" = $1 where "fromPath" = $2', ["/offers/forbidden", "/offers/first"])).rejects.toThrow(/immutable history|нет доступа|permission denied/i);
      await client.query("rollback");
    } finally {
      await client.end();
    }
  });

  it("requires a registered target for REDIRECTED and tombstones GONE paths", async () => {
    const principal = admin();
    const suffix = randomUUID().slice(0, 8);
    const setup = await runInPrincipalDatabaseTransaction(principal, async (transaction) => {
      const organization = await transaction.organization.create({ data: { name: `Lifecycle Org ${suffix}`, slug: `lifecycle-org-${suffix}` } });
      const project = await transaction.project.create({ data: { organizationId: organization.id, name: `Lifecycle ${suffix}`, slug: `lifecycle-${suffix}` } });
      return { organizationId: organization.id, projectId: project.id };
    });
    await projectUrlRegistryCommands.replaceProjectUrlPolicy(principal, {
      ...setup, version: 0, policyKey: "site-v1", pathTemplates: [{ entityType: "INVENTORY", template: "/offers/{slug}" }], reservedNamespaces: [],
    });
    const first = await projectUrlRegistryCommands.createProjectUrlEntry(principal, { ...setup, entityType: "INVENTORY", entityUid: createUlid(), slug: "old", canonicalPath: "/offers/old" });
    await expect(projectUrlRegistryCommands.transitionProjectUrlLifecycle(principal, {
      ...setup, urlEntryId: first.urlEntryId, version: first.version, factualLifecycle: "INACTIVE", presentationLifecycle: "REDIRECTED", redirectTargetPath: "/offers/missing", reason: "LIFECYCLE",
    })).rejects.toThrow("PROJECT_URL_REDIRECT_TARGET_INVALID");
    const targetEntry = await projectUrlRegistryCommands.createProjectUrlEntry(principal, { ...setup, entityType: "INVENTORY", entityUid: createUlid(), slug: "new", canonicalPath: "/offers/new" });
    const redirected = await projectUrlRegistryCommands.transitionProjectUrlLifecycle(principal, {
      ...setup, urlEntryId: first.urlEntryId, version: first.version, factualLifecycle: "INACTIVE", presentationLifecycle: "REDIRECTED", redirectTargetPath: targetEntry.canonicalPath, reason: "LIFECYCLE",
    });
    expect(redirected).toMatchObject({ presentationLifecycle: "REDIRECTED", redirectTargetPath: "/offers/new" });
    const gone = await projectUrlRegistryCommands.transitionProjectUrlLifecycle(principal, {
      ...setup, urlEntryId: targetEntry.urlEntryId, version: targetEntry.version, factualLifecycle: "ARCHIVED", presentationLifecycle: "GONE", redirectTargetPath: null, reason: "RETIRE",
    });
    expect(gone.retiredAt).toBeInstanceOf(Date);
    await expect(projectUrlRegistryCommands.changeProjectUrlPath(principal, {
      ...setup, urlEntryId: gone.urlEntryId, version: gone.version, slug: "resurrected", canonicalPath: "/offers/resurrected",
    })).rejects.toThrow("PROJECT_URL_STALE");
    await expect(projectUrlRegistryCommands.createProjectUrlEntry(principal, {
      ...setup, entityType: "INVENTORY", entityUid: createUlid(), slug: "old-new", canonicalPath: "/offers/new",
    })).rejects.toThrow("PROJECT_URL_PATH_CONFLICT");
  });
});
