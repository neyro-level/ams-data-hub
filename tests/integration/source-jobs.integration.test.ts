import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sourceRegistryCommands } from "../../src/modules/ingestion-core/server.ts";
import {
  createPrismaSourceJobRepository,
  PgBossSourceJobQueue,
  SOURCE_IMPORT_QUEUE,
} from "../../src/modules/ingestion-core/worker.ts";
import {
  getPgBoss,
  stopPgBoss,
} from "../../src/modules/platform-operations/infrastructure/pg-boss-client.ts";
import { createProjectJobPrincipal } from "../../src/platform/authorization/principal-factories.ts";
import type { PlatformAdminPrincipal, ProjectJobPrincipal } from "../../src/platform/authorization/principal.ts";
import { runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";

function admin(): PlatformAdminPrincipal {
  return {
    kind: "platform-admin",
    userId: `source-job-admin-${randomUUID()}`,
    correlationId: randomUUID(),
  };
}

describe("source job repository", () => {
  it("enforces one queued or active pg-boss job per source key", async () => {
    const boss = await getPgBoss();
    const queue = new PgBossSourceJobQueue(boss);
    const sourceId = `source-lock-${randomUUID()}`;
    let jobId: string | null = null;
    try {
      await queue.reconcileSchedules([]);
      const payload = {
        schemaVersion: 1,
        organizationId: "org-lock",
        projectId: "project-lock",
        sourceId,
        trigger: "MANUAL",
      } as const;
      const first = await boss.send(SOURCE_IMPORT_QUEUE, payload, { singletonKey: sourceId });
      jobId = first;
      const second = await boss.send(SOURCE_IMPORT_QUEUE, payload, { singletonKey: sourceId });
      expect(first).toEqual(expect.any(String));
      expect(second).toBeNull();
    } finally {
      if (jobId) await boss.deleteJob(SOURCE_IMPORT_QUEUE, jobId);
      await stopPgBoss();
    }
  });

  it("discovers schedules globally but loads execution state only through the scoped project-job principal", async () => {
    const principal = admin();
    const suffix = randomUUID().slice(0, 8);
    const setup = await runInPrincipalDatabaseTransaction(principal, async (transaction) => {
      const organization = await transaction.organization.create({
        data: { name: `Source Job Org ${suffix}`, slug: `source-job-org-${suffix}` },
      });
      const active = await transaction.project.create({
        data: {
          organizationId: organization.id,
          name: `Active Source Job ${suffix}`,
          slug: `active-source-job-${suffix}`,
        },
      });
      const suspended = await transaction.project.create({
        data: {
          organizationId: organization.id,
          name: `Suspended Source Job ${suffix}`,
          slug: `suspended-source-job-${suffix}`,
          serviceState: "SUSPENDED",
        },
      });
      return { organizationId: organization.id, activeProjectId: active.id, suspendedProjectId: suspended.id };
    });
    const created = await sourceRegistryCommands.createSource(principal, {
      organizationId: setup.organizationId,
      projectId: setup.suspendedProjectId,
      sourceKey: "scheduled-source",
      name: "Scheduled source",
      endpointCredentialRef: "SYNTHETIC_SOURCE_JOB_ENDPOINT",
      adapterKey: "yrl-realty-2010",
      adapterVersion: "1.0.0",
      profileKey: "default-v1",
      profileVersion: "1.0.0",
      datasetType: "RESALE",
      transportType: "HTTPS_XML",
      sharingPolicy: "PROJECT_ONLY",
      schedulePolicy: { mode: "SCHEDULED", cadenceMinutes: 60 },
      safetyPolicyId: "",
      expectedNamespace: "",
      expectedProducer: "",
    });

    const repository = createPrismaSourceJobRepository();
    expect(await repository.listSchedulingSources()).toContainEqual(
      expect.objectContaining({ sourceId: created.sourceId, projectId: setup.suspendedProjectId }),
    );

    const scoped = createProjectJobPrincipal({
      jobName: "source-import",
      organizationId: setup.organizationId,
      projectId: setup.suspendedProjectId,
    }) as ProjectJobPrincipal;
    await expect(repository.loadExecutionContext(scoped, created.sourceId)).resolves.toMatchObject({
      sourceId: created.sourceId,
      serviceState: "SUSPENDED",
    });

    const wrongProject = createProjectJobPrincipal({
      jobName: "source-import",
      organizationId: setup.organizationId,
      projectId: setup.activeProjectId,
    }) as ProjectJobPrincipal;
    await expect(repository.loadExecutionContext(wrongProject, created.sourceId)).resolves.toBeNull();
  });
});
