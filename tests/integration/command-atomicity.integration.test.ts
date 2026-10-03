import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createOrganization } from "../../src/modules/identity-access/server.ts";
import type { ProjectAuditInput } from "../../src/modules/project-registry/application/ports/project-registry-repository.ts";
import { createProjectRegistryCommands } from "../../src/modules/project-registry/application/project-registry-commands.ts";
import { PrismaProjectRegistryRepository } from "../../src/modules/project-registry/infrastructure/prisma-project-registry-repository.ts";
import { requestMaintenance } from "../../src/modules/platform-operations/server.ts";
import type { PlatformAdminPrincipal, TenantUserPrincipal } from "../../src/platform/authorization/principal.ts";
import { runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";

function platformAdmin(): PlatformAdminPrincipal {
  return {
    kind: "platform-admin",
    userId: `e04-admin-${randomUUID()}`,
    correlationId: randomUUID(),
  };
}

class FailingAuditProjectRepository extends PrismaProjectRegistryRepository {
  override appendAudit(input: ProjectAuditInput): Promise<void> {
    void input;
    return Promise.reject(new Error("E04_AUDIT_FAILURE"));
  }
}

describe("E04 command atomicity", () => {
  it("rejects an unauthorized command before persistence", async () => {
    const suffix = randomUUID().slice(0, 12);
    const principal: TenantUserPrincipal = {
      kind: "tenant-user",
      userId: `e04-tenant-${suffix}`,
      organizationId: `e04-org-${suffix}`,
      membershipId: `e04-membership-${suffix}`,
    role: "ORG_ADMIN",
    projectIds: "*",
      correlationId: randomUUID(),
    };
    const slug = `e04-unauthorized-${suffix}`;

    const commands = createProjectRegistryCommands({
      createRepository: (transaction) => new PrismaProjectRegistryRepository(transaction),
    });
    await expect(commands.createProject(principal, {
      organizationId: principal.organizationId,
      slug,
      name: "Must not persist",
      description: "Authorization precedes persistence",
      status: "ACTIVE",
    })).rejects.toThrow("PROJECT_REGISTRY_ADMIN_ACCESS_DENIED");

    const count = await runInPrincipalDatabaseTransaction(platformAdmin(), (transaction) =>
      transaction.project.count({ where: { slug } }),
    );
    expect(count).toBe(0);
  });

  it("rolls back business state when the command audit write fails", async () => {
    const principal = platformAdmin();
    const suffix = randomUUID().slice(0, 12);
    const organization = await createOrganization(principal, {
      slug: `e04-atomic-${suffix}`,
      name: `E04 Atomic ${suffix}`,
    });
    const commands = createProjectRegistryCommands({
      createRepository: (transaction) => new FailingAuditProjectRepository(transaction),
    });

    await expect(commands.createProject(principal, {
      organizationId: organization.organizationId,
      slug: `e04-rollback-${suffix}`,
      name: `E04 Rollback ${suffix}`,
      description: "Must not survive a failed audit write",
      status: "ACTIVE",
    })).rejects.toThrow("E04_AUDIT_FAILURE");

    const counts = await runInPrincipalDatabaseTransaction(principal, async (transaction) => ({
      projects: await transaction.project.count({
        where: { slug: `e04-rollback-${suffix}` },
      }),
      audits: await transaction.auditEvent.count({
        where: {
          correlationId: principal.correlationId,
          action: "project.create",
        },
      }),
    }));
    expect(counts).toEqual({ projects: 0, audits: 0 });
  });

  it("commits idempotency, outbox and audit together and reuses the result", async () => {
    const principal = platformAdmin();
    const suffix = randomUUID().slice(0, 12);
    const input = { idempotencyKey: `e04-maintenance-${suffix}` };

    const first = await requestMaintenance(principal, input);
    const duplicate = await requestMaintenance(principal, input);
    const counts = await runInPrincipalDatabaseTransaction(principal, async (transaction) => ({
      idempotency: await transaction.idempotencyKey.count({
        where: { scope: "platform-admin.maintenance", key: input.idempotencyKey },
      }),
      outbox: await transaction.outboxEvent.count({ where: { id: first.outboxEventId } }),
      audit: await transaction.auditEvent.count({
        where: {
          correlationId: principal.correlationId,
          action: "platform.maintenance.request",
        },
      }),
    }));

    expect(first.duplicate).toBe(false);
    expect(duplicate).toEqual({ outboxEventId: first.outboxEventId, duplicate: true });
    expect(counts).toEqual({ idempotency: 1, outbox: 1, audit: 1 });
  });
});
