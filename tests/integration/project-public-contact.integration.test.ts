import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { readTestDatabaseTarget } from "../../scripts/verify-test-database-env.mjs";
import { getProjectPublicContact, projectPublicContactCommands } from "../../src/modules/project-state/server.ts";
import type { PlatformAdminPrincipal, TenantUserPrincipal } from "../../src/platform/authorization/principal.ts";
import { runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";

const target = readTestDatabaseTarget(process.env, { allowApplicationTarget: true });

function admin(): PlatformAdminPrincipal {
  return { kind: "platform-admin", userId: `contact-admin-${randomUUID()}`, correlationId: randomUUID() };
}

function tenant(organizationId: string): TenantUserPrincipal {
  return {
    kind: "tenant-user",
    userId: `contact-tenant-${randomUUID()}`,
    organizationId,
    membershipId: `contact-membership-${randomUUID()}`,
    role: "ORG_OWNER",
    correlationId: randomUUID(),
  };
}

describe("project public contacts", () => {
  it("stores one isolated fallback contact per project and returns a whitelisted public DTO", async () => {
    const principal = admin();
    const suffix = randomUUID().slice(0, 8);
    const setup = await runInPrincipalDatabaseTransaction(principal, async (transaction) => {
      const organization = await transaction.organization.create({ data: { name: `Contact Org ${suffix}`, slug: `contact-org-${suffix}` } });
      const first = await transaction.project.create({ data: { organizationId: organization.id, name: `Contact A ${suffix}`, slug: `contact-a-${suffix}` } });
      const second = await transaction.project.create({ data: { organizationId: organization.id, name: `Contact B ${suffix}`, slug: `contact-b-${suffix}` } });
      return { organizationId: organization.id, firstProjectId: first.id, secondProjectId: second.id };
    });

    await projectPublicContactCommands.replaceProjectPublicContact(principal, {
      organizationId: setup.organizationId,
      projectId: setup.firstProjectId,
      version: 0,
      phone: "+7 900 111-11-11",
      email: "first@example.test",
      addressPublic: "Первый публичный адрес",
      messengers: ["https://t.me/first"],
      hours: "Пн–Пт",
    });
    await projectPublicContactCommands.replaceProjectPublicContact(principal, {
      organizationId: setup.organizationId,
      projectId: setup.secondProjectId,
      version: 0,
      phone: "+7 900 222-22-22",
      email: "",
      addressPublic: "",
      messengers: [],
      hours: "",
    });

    const publicContact = await getProjectPublicContact(tenant(setup.organizationId), {
      organizationId: setup.organizationId,
      projectId: setup.firstProjectId,
    });
    expect(publicContact).toEqual({
      phone: "+7 900 111-11-11",
      email: "first@example.test",
      addressPublic: "Первый публичный адрес",
      messengers: ["https://t.me/first"],
      hours: "Пн–Пт",
    });
    expect(Object.keys(publicContact).sort()).toEqual(["addressPublic", "email", "hours", "messengers", "phone"]);

    const audit = await runInPrincipalDatabaseTransaction(principal, (transaction) => transaction.auditEvent.findFirstOrThrow({
      where: { organizationId: setup.organizationId, entityId: setup.firstProjectId, action: "project-public-contact.replace" },
      select: { beforeMarker: true, afterMarker: true },
    }));
    const auditText = JSON.stringify(audit);
    expect(auditText).not.toContain("+7 900");
    expect(auditText).not.toContain("first@example.test");
    expect(audit.afterMarker).toMatchObject({ hasEmail: true, hasAddress: true, messengerCount: 1, hasHours: true, version: 1 });

    const client = new pg.Client({ host: target.host, port: target.port, database: target.database, user: target.user, password: target.password, ssl: target.sslmode === "require" });
    await client.connect();
    try {
      await client.query("set role ams_data_hub_web");
      await client.query("begin");
      await client.query("select set_config('app.principal_kind', 'tenant-user', true)");
      await client.query("select set_config('app.actor_id', 'contact-reader', true)");
      await client.query("select set_config('app.organization_id', $1, true)", [setup.organizationId]);
      await client.query("select set_config('app.project_id', $1, true)", [setup.firstProjectId]);
      const visible = await client.query<{ projectId: string; phone: string }>('select "projectId", "phone" from "ProjectPublicContact" order by "projectId"');
      expect(visible.rows).toEqual([{ projectId: setup.firstProjectId, phone: "+7 900 111-11-11" }]);
      const forbidden = await client.query('update "ProjectPublicContact" set "phone" = $1 where "projectId" = $2', ["+7 900 999-99-99", setup.firstProjectId]);
      expect(forbidden.rowCount).toBe(0);
      await client.query("rollback");
    } finally {
      await client.end();
    }
  });

  it("rejects stale, cross-organization and non-admin writes", async () => {
    const principal = admin();
    const suffix = randomUUID().slice(0, 8);
    const setup = await runInPrincipalDatabaseTransaction(principal, async (transaction) => {
      const organization = await transaction.organization.create({ data: { name: `Contact Guard ${suffix}`, slug: `contact-guard-${suffix}` } });
      const project = await transaction.project.create({ data: { organizationId: organization.id, name: `Contact Guard ${suffix}`, slug: `contact-guard-project-${suffix}` } });
      return { organizationId: organization.id, projectId: project.id };
    });
    const input = { organizationId: setup.organizationId, projectId: setup.projectId, version: 0, phone: "+7 900 333-33-33", email: "", addressPublic: "", messengers: [], hours: "" };
    await projectPublicContactCommands.replaceProjectPublicContact(principal, input);
    await expect(projectPublicContactCommands.replaceProjectPublicContact(principal, input)).rejects.toThrow("PROJECT_PUBLIC_CONTACT_STALE");
    await expect(projectPublicContactCommands.replaceProjectPublicContact(tenant(setup.organizationId), { ...input, version: 1 })).rejects.toThrow("PROJECT_STATE_ADMIN_ACCESS_DENIED");
    await expect(getProjectPublicContact(tenant(`foreign-${suffix}`), { organizationId: setup.organizationId, projectId: setup.projectId })).rejects.toThrow("PROJECT_PUBLIC_CONTACT_ACCESS_DENIED");
  });
});
