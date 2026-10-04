import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { readTestDatabaseTarget } from "../../scripts/verify-test-database-env.mjs";
import { getSourceAdminData, sourceRegistryCommands } from "../../src/modules/ingestion-core/server.ts";
import type { PlatformAdminPrincipal, TenantUserPrincipal } from "../../src/platform/authorization/principal.ts";
import { runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";

const target = readTestDatabaseTarget(process.env, { allowApplicationTarget: true });

function admin(): PlatformAdminPrincipal {
  return { kind: "platform-admin", userId: `source-admin-${randomUUID()}`, correlationId: randomUUID() };
}
function tenant(organizationId: string): TenantUserPrincipal {
  return { kind: "tenant-user", userId: `source-tenant-${randomUUID()}`, organizationId, membershipId: `source-member-${randomUUID()}`, role: "ORG_ADMIN", projectIds: "*", correlationId: randomUUID() };
}
describe("source registry", () => {
  it("stores a SecretRef instead of an endpoint and isolates source lifecycle per project", async () => {
    const principal = admin();
    const suffix = randomUUID().slice(0, 8);
    const setup = await runInPrincipalDatabaseTransaction(principal, async (transaction) => {
      const organization = await transaction.organization.create({ data: { name: `Source Org ${suffix}`, slug: `source-org-${suffix}` } });
      const first = await transaction.project.create({ data: { organizationId: organization.id, name: `Source A ${suffix}`, slug: `source-a-${suffix}` } });
      const second = await transaction.project.create({ data: { organizationId: organization.id, name: `Source B ${suffix}`, slug: `source-b-${suffix}` } });
      return { organizationId: organization.id, firstProjectId: first.id, secondProjectId: second.id };
    });
    const secretRefName = `SYNTHETIC_FEED_ENDPOINT_${suffix.toUpperCase()}`;
    const syntheticEndpoint = `https://feed.example.test/${suffix}/private.xml`;
    process.env[secretRefName] = syntheticEndpoint;
    const firstScope = { organizationId: setup.organizationId, projectId: setup.firstProjectId };
    try {
      const created = await sourceRegistryCommands.createSource(principal, {
        ...firstScope,
        sourceKey: "mixed-realty",
        name: "Synthetic mixed realty",
        endpointCredentialRef: secretRefName,
        adapterKey: "yrl-realty-2010",
        adapterVersion: "1.0.0",
        profileKey: "neutral-v1",
        profileVersion: "1.0.0",
        datasetType: "MIXED_REALTY",
        transportType: "HTTPS_XML",
        sharingPolicy: "PROJECT_ONLY",
        schedulePolicy: { mode: "SCHEDULED", cadenceMinutes: 60 },
        safetyPolicyId: "",
        expectedNamespace: "urn:example:yrl",
        expectedProducer: "Synthetic producer",
      });
      const adminData = await getSourceAdminData(principal);
      const dto = adminData.sources.find((source) => source.sourceId === created.sourceId);
      expect(dto).toMatchObject({ enabled: false, credential: { configured: true, displayValue: "[REDACTED]" }, pendingManualRuns: 0 });
      expect(JSON.stringify(dto)).not.toContain(secretRefName);
      expect(JSON.stringify(dto)).not.toContain(syntheticEndpoint);

      const manual = await sourceRegistryCommands.requestManualSourceRun(principal, { ...firstScope, sourceId: created.sourceId, idempotencyKey: `manual-${suffix}` });
      const repeated = await sourceRegistryCommands.requestManualSourceRun(principal, { ...firstScope, sourceId: created.sourceId, idempotencyKey: `manual-${suffix}` });
      expect(manual.duplicate).toBe(false);
      expect(repeated).toEqual({ requestId: manual.requestId, duplicate: true });
      const enabled = await sourceRegistryCommands.setSourceEnabled(principal, { ...firstScope, sourceId: created.sourceId, version: created.version, enabled: true });
      expect(enabled.enabled).toBe(true);
      await expect(sourceRegistryCommands.setSourceEnabled(principal, { organizationId: setup.organizationId, projectId: setup.secondProjectId, sourceId: created.sourceId, version: enabled.version, enabled: false })).rejects.toThrow("SOURCE_REGISTRY_NOT_FOUND");
      await expect(sourceRegistryCommands.setSourceEnabled(tenant(setup.organizationId), { ...firstScope, sourceId: created.sourceId, version: enabled.version, enabled: false })).rejects.toThrow("SOURCE_REGISTRY_ADMIN_ACCESS_DENIED");

      const stored = await runInPrincipalDatabaseTransaction(principal, (transaction) => transaction.sourceCredentialRef.findUniqueOrThrow({ where: { sourceId: created.sourceId } }));
      expect(stored.endpointCredentialRefName).toBe(secretRefName);
      expect(JSON.stringify(stored)).not.toContain(syntheticEndpoint);
      const audits = await runInPrincipalDatabaseTransaction(principal, (transaction) => transaction.auditEvent.findMany({ where: { organizationId: setup.organizationId, entityId: created.sourceId, source: "ingestion-core" } }));
      const auditText = JSON.stringify(audits);
      expect(auditText).not.toContain(secretRefName);
      expect(auditText).not.toContain(syntheticEndpoint);

      const client = new pg.Client({ host: target.host, port: target.port, database: target.database, user: target.user, password: target.password, ssl: target.sslmode === "require" });
      await client.connect();
      try {
        await client.query("set role ams_data_hub_web");
        await client.query("begin");
        await client.query("select set_config('app.principal_kind', 'tenant-user', true)");
        await client.query("select set_config('app.actor_id', 'source-tenant', true)");
        await client.query("select set_config('app.organization_id', $1, true)", [setup.organizationId]);
        await client.query("select set_config('app.project_ids', $1, true)", [setup.firstProjectId]);
        expect((await client.query('select count(*)::int AS count from "Source"')).rows[0].count).toBe(0);
        expect((await client.query('select count(*)::int AS count from "SourceCredentialRef"')).rows[0].count).toBe(0);
        await client.query("rollback");
        await client.query("reset role");
        await client.query("set role ams_data_hub_worker");
        await client.query("begin");
        await client.query("select set_config('app.principal_kind', 'job', true)");
        await client.query("select set_config('app.actor_id', 'source-job', true)");
        await client.query("select set_config('app.organization_id', $1, true)", [setup.organizationId]);
        await client.query("select set_config('app.project_ids', $1, true)", [setup.firstProjectId]);
        expect((await client.query('select count(*)::int AS count from "Source"')).rows[0].count).toBe(1);
        await client.query("rollback");
        await client.query("begin");
        await client.query("select set_config('app.principal_kind', 'job', true)");
        await client.query("select set_config('app.actor_id', 'source-job', true)");
        await client.query("select set_config('app.organization_id', $1, true)", [setup.organizationId]);
        await client.query("select set_config('app.project_ids', $1, true)", [setup.secondProjectId]);
        expect((await client.query('select count(*)::int AS count from "Source"')).rows[0].count).toBe(0);
        await client.query("rollback");
      } finally {
        await client.end();
      }
    } finally {
      delete process.env[secretRefName];
    }
  });

  it("rejects duplicate keys, stale updates and raw endpoint values", async () => {
    const principal = admin();
    const suffix = randomUUID().slice(0, 8);
    const setup = await runInPrincipalDatabaseTransaction(principal, async (transaction) => {
      const organization = await transaction.organization.create({ data: { name: `Source Guard ${suffix}`, slug: `source-guard-${suffix}` } });
      const project = await transaction.project.create({ data: { organizationId: organization.id, name: `Source Guard ${suffix}`, slug: `source-guard-project-${suffix}` } });
      return { organizationId: organization.id, projectId: project.id };
    });
    const input = {
      ...setup, sourceKey: "guard-source", name: "Guard source", endpointCredentialRef: "SYNTHETIC_GUARD_ENDPOINT",
      adapterKey: "neutral-adapter", adapterVersion: "1", profileKey: "neutral-profile", profileVersion: "1", datasetType: "RESALE" as const,
      transportType: "HTTPS_XML" as const, sharingPolicy: "PROJECT_ONLY" as const, schedulePolicy: { mode: "MANUAL_ONLY" as const }, safetyPolicyId: "", expectedNamespace: "", expectedProducer: "",
    };
    const created = await sourceRegistryCommands.createSource(principal, input);
    await expect(sourceRegistryCommands.createSource(principal, input)).rejects.toThrow("SOURCE_REGISTRY_CONFLICT");
    await expect(sourceRegistryCommands.createSource(principal, { ...input, sourceKey: "raw-endpoint", endpointCredentialRef: "https://feed.example.test/raw.xml" })).rejects.toThrow();
    const update = { ...setup, sourceId: created.sourceId, version: created.version, name: "Updated", adapterKey: input.adapterKey, adapterVersion: "2", profileKey: input.profileKey, profileVersion: "2", datasetType: input.datasetType, schedulePolicy: input.schedulePolicy, safetyPolicyId: "", expectedNamespace: "", expectedProducer: "" };
    await sourceRegistryCommands.updateSource(principal, update);
    await expect(sourceRegistryCommands.updateSource(principal, update)).rejects.toThrow("SOURCE_REGISTRY_STALE");
  });
});
