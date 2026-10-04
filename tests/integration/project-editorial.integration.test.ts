import { randomUUID } from "node:crypto";
import { createUlid } from "@ams-data-hub/data-contracts";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { readTestDatabaseTarget } from "../../scripts/verify-test-database-env.mjs";
import { entityEditorialCommands, listProjectEditorialPublic } from "../../src/modules/project-state/server.ts";
import type { JobPrincipal, PlatformAdminPrincipal, TenantUserPrincipal } from "../../src/platform/authorization/principal.ts";
import { runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";

const target = readTestDatabaseTarget(process.env, { allowApplicationTarget: true });

function admin(): PlatformAdminPrincipal {
  return { kind: "platform-admin", userId: `editorial-admin-${randomUUID()}`, correlationId: randomUUID() };
}

function tenant(organizationId: string): TenantUserPrincipal {
  return { kind: "tenant-user", userId: `editorial-tenant-${randomUUID()}`, organizationId, membershipId: `editorial-member-${randomUUID()}`, role: "ORG_OWNER", correlationId: randomUUID() };
}

function job(organizationId: string): JobPrincipal {
  return { kind: "job", jobName: `editorial-job-${randomUUID()}`, organizationId, correlationId: randomUUID() };
}

describe("project editorial", () => {
  it("isolates projects, maps safe fields and obeys the current source media policy", async () => {
    const principal = admin();
    const suffix = randomUUID().slice(0, 8);
    const entityUid = createUlid();
    const setup = await runInPrincipalDatabaseTransaction(principal, async (transaction) => {
      const organization = await transaction.organization.create({ data: { name: `Editorial Org ${suffix}`, slug: `editorial-org-${suffix}` } });
      const first = await transaction.project.create({ data: { organizationId: organization.id, name: `Editorial A ${suffix}`, slug: `editorial-a-${suffix}` } });
      const second = await transaction.project.create({ data: { organizationId: organization.id, name: `Editorial B ${suffix}`, slug: `editorial-b-${suffix}` } });
      return { organizationId: organization.id, firstProjectId: first.id, secondProjectId: second.id };
    });
    const key = { organizationId: setup.organizationId, projectId: setup.firstProjectId, entityType: "INVENTORY" as const, entityUid };
    const worker = job(setup.organizationId);
    await entityEditorialCommands.replaceEntityMediaOrderPolicy(worker, {
      ...key, version: 0, sourceMediaOrder: ["media-a", "media-b", "media-c"], isImageOrderChangeAllowed: true,
    });
    await entityEditorialCommands.replaceEntityEditorial(principal, {
      ...key, version: 0,
      shortDescription: "Коротко",
      description: "Публичное описание",
      faq: [{ question: "Можно?", answer: "Можно." }],
      presentationNotes: "Внутренняя заметка — не публиковать",
      mediaOrder: ["media-c", "media-a", "media-b"],
    });

    const firstPublic = await listProjectEditorialPublic(tenant(setup.organizationId), { organizationId: setup.organizationId, projectId: setup.firstProjectId });
    expect(firstPublic).toEqual([{
      entityType: "INVENTORY", entityUid,
      shortDescription: "Коротко", description: "Публичное описание",
      faq: [{ question: "Можно?", answer: "Можно." }],
      mediaOrder: ["media-c", "media-a", "media-b"],
      isImageOrderChangeAllowed: true,
    }]);
    expect(JSON.stringify(firstPublic)).not.toContain("Внутренняя заметка");
    await expect(listProjectEditorialPublic(tenant(setup.organizationId), { organizationId: setup.organizationId, projectId: setup.secondProjectId })).resolves.toEqual([]);

    await entityEditorialCommands.replaceEntityMediaOrderPolicy(worker, {
      ...key, version: 1, sourceMediaOrder: ["media-b", "media-a", "media-c"], isImageOrderChangeAllowed: false,
    });
    const lockedPublic = await listProjectEditorialPublic(tenant(setup.organizationId), { organizationId: setup.organizationId, projectId: setup.firstProjectId });
    expect(lockedPublic[0]).toMatchObject({ mediaOrder: ["media-b", "media-a", "media-c"], isImageOrderChangeAllowed: false });
    await expect(entityEditorialCommands.replaceEntityEditorial(principal, {
      ...key, version: 1, shortDescription: "Коротко", description: "Публичное описание", faq: [], presentationNotes: "", mediaOrder: ["media-c", "media-a", "media-b"],
    })).rejects.toThrow("PROJECT_EDITORIAL_MEDIA_ORDER_LOCKED");

    const audits = await runInPrincipalDatabaseTransaction(principal, (transaction) => transaction.auditEvent.findMany({
      where: { organizationId: setup.organizationId, entityId: `INVENTORY:${entityUid}`, source: "project-state" },
      select: { beforeMarker: true, afterMarker: true },
    }));
    expect(audits).toHaveLength(3);
    const auditText = JSON.stringify(audits);
    expect(auditText).not.toContain("Публичное описание");
    expect(auditText).not.toContain("media-a");

    const client = new pg.Client({ host: target.host, port: target.port, database: target.database, user: target.user, password: target.password, ssl: target.sslmode === "require" });
    await client.connect();
    try {
      await client.query("set role ams_data_hub_web");
      await client.query("begin");
      await client.query("select set_config('app.principal_kind', 'tenant-user', true)");
      await client.query("select set_config('app.actor_id', 'editorial-reader', true)");
      await client.query("select set_config('app.organization_id', $1, true)", [setup.organizationId]);
      await client.query("select set_config('app.project_id', $1, true)", [setup.firstProjectId]);
      const visible = await client.query<{ projectId: string }>('select "projectId" from "EntityEditorial"');
      expect(visible.rows).toEqual([{ projectId: setup.firstProjectId }]);
      const forbidden = await client.query('update "EntityEditorial" set "description" = $1 where "projectId" = $2', ["forbidden", setup.firstProjectId]);
      expect(forbidden.rowCount).toBe(0);
      await client.query("rollback");
    } finally {
      await client.end();
    }
  });

  it("rejects raw HTML, stale versions, foreign jobs and tenant writes", async () => {
    const principal = admin();
    const suffix = randomUUID().slice(0, 8);
    const setup = await runInPrincipalDatabaseTransaction(principal, async (transaction) => {
      const organization = await transaction.organization.create({ data: { name: `Editorial Guard ${suffix}`, slug: `editorial-guard-${suffix}` } });
      const project = await transaction.project.create({ data: { organizationId: organization.id, name: `Editorial Guard ${suffix}`, slug: `editorial-guard-project-${suffix}` } });
      return { organizationId: organization.id, projectId: project.id };
    });
    const key = { organizationId: setup.organizationId, projectId: setup.projectId, entityType: "DEVELOPMENT" as const, entityUid: createUlid() };
    const input = { ...key, version: 0, shortDescription: "", description: "Plain text", faq: [], presentationNotes: "", mediaOrder: [] };
    await entityEditorialCommands.replaceEntityEditorial(principal, input);
    await expect(entityEditorialCommands.replaceEntityEditorial(principal, input)).rejects.toThrow("PROJECT_EDITORIAL_STALE");
    await expect(entityEditorialCommands.replaceEntityEditorial(principal, { ...input, version: 1, description: "<b>raw</b>" })).rejects.toThrow();
    await expect(entityEditorialCommands.replaceEntityEditorial(tenant(setup.organizationId), { ...input, version: 1 })).rejects.toThrow("PROJECT_STATE_ADMIN_ACCESS_DENIED");
    await expect(entityEditorialCommands.replaceEntityMediaOrderPolicy(job(`foreign-${suffix}`), { ...key, version: 0, sourceMediaOrder: [], isImageOrderChangeAllowed: false })).rejects.toThrow("PROJECT_EDITORIAL_JOB_ACCESS_DENIED");
  });
});
