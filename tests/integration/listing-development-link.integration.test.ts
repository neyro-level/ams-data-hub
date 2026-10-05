import { randomUUID } from "node:crypto";
import { createUlid } from "@ams-data-hub/data-contracts";
import { describe, expect, it } from "vitest";
import { listingDevelopmentLinkCommands } from "../../src/modules/project-state/server.ts";
import type { PlatformAdminPrincipal, ProjectJobPrincipal, TenantUserPrincipal } from "../../src/platform/authorization/principal.ts";
import { runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";

function admin(): PlatformAdminPrincipal {
  return { kind: "platform-admin", userId: `link-admin-${randomUUID()}`, correlationId: randomUUID() };
}

function projectJob(organizationId: string, projectId: string): ProjectJobPrincipal {
  return { kind: "project-job", jobName: `link-job-${randomUUID()}`, organizationId, projectId, correlationId: randomUUID() };
}

function tenant(organizationId: string, projectId: string): TenantUserPrincipal {
  return {
    kind: "tenant-user",
    userId: `link-tenant-${randomUUID()}`,
    organizationId,
    membershipId: `link-member-${randomUUID()}`,
    role: "ORG_ADMIN",
    projectIds: [projectId],
    correlationId: randomUUID(),
  };
}

describe("listing development links", () => {
  it("creates only a candidate and requires an explicit admin decision without mutating shared catalog", async () => {
    const principal = admin();
    const suffix = randomUUID().slice(0, 8);
    const setup = await runInPrincipalDatabaseTransaction(principal, async (transaction) => {
      const organization = await transaction.organization.create({ data: { name: `Link Org ${suffix}`, slug: `link-org-${suffix}` } });
      const project = await transaction.project.create({ data: { organizationId: organization.id, name: `Link Project ${suffix}`, slug: `link-project-${suffix}` } });
      const region = await transaction.region.create({ data: { uid: createUlid(), code: "RU-LNK", name: `Link Region ${suffix}`, normalizedName: `link region ${suffix}` } });
      const city = await transaction.city.create({ data: { uid: createUlid(), regionUid: region.uid, name: `Link City ${suffix}`, normalizedName: `link city ${suffix}` } });
      const developer = await transaction.developer.create({ data: { uid: createUlid(), name: `Link Developer ${suffix}`, normalizedName: `link developer ${suffix}` } });
      const development = await transaction.development.create({
        data: { uid: createUlid(), developerUid: developer.uid, cityUid: city.uid, name: `Link Development ${suffix}`, normalizedName: `link development ${suffix}` },
      });
      return { organizationId: organization.id, projectId: project.id, developmentUid: development.uid, developmentVersion: development.version };
    });

    const candidate = await listingDevelopmentLinkCommands.createCandidate(projectJob(setup.organizationId, setup.projectId), {
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      inventoryUid: createUlid(),
      developmentUid: setup.developmentUid,
      candidateReason: "Совпали нормализованный адрес и alias ЖК",
      candidateConfidence: 0.91,
      sourceRevisionId: "source-revision-synthetic",
    });
    expect(candidate).toMatchObject({ status: "CANDIDATE", version: 1 });

    await expect(listingDevelopmentLinkCommands.decide(tenant(setup.organizationId, setup.projectId), {
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      linkId: candidate.linkId,
      version: 1,
      decision: "CONFIRMED",
    })).rejects.toThrow("PROJECT_STATE_ADMIN_ACCESS_DENIED");

    const confirmed = await listingDevelopmentLinkCommands.decide(principal, {
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      linkId: candidate.linkId,
      version: 1,
      decision: "CONFIRMED",
    });
    expect(confirmed).toEqual({ linkId: candidate.linkId, status: "CONFIRMED", version: 2 });

    const proof = await runInPrincipalDatabaseTransaction(principal, async (transaction) => ({
      development: await transaction.development.findUniqueOrThrow({ where: { uid: setup.developmentUid }, select: { version: true } }),
      link: await transaction.listingDevelopmentLink.findUniqueOrThrow({ where: { id: candidate.linkId } }),
      audits: await transaction.auditEvent.findMany({ where: { entityType: "ListingDevelopmentLink", entityId: candidate.linkId } }),
    }));
    expect(proof.development.version).toBe(setup.developmentVersion);
    expect(proof.link).toMatchObject({ status: "CONFIRMED", developmentUid: setup.developmentUid, confirmedBy: principal.userId, version: 2 });
    expect(proof.audits).toHaveLength(2);
    expect(JSON.stringify(proof.audits)).not.toContain("Совпали нормализованный адрес");
  });

  it("cannot confirm an unresolved candidate or create it outside the exact project job scope", async () => {
    const principal = admin();
    const suffix = randomUUID().slice(0, 8);
    const setup = await runInPrincipalDatabaseTransaction(principal, async (transaction) => {
      const organization = await transaction.organization.create({ data: { name: `Unresolved Org ${suffix}`, slug: `unresolved-org-${suffix}` } });
      const project = await transaction.project.create({ data: { organizationId: organization.id, name: `Unresolved Project ${suffix}`, slug: `unresolved-project-${suffix}` } });
      return { organizationId: organization.id, projectId: project.id };
    });
    const input = {
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      inventoryUid: createUlid(),
      developmentUid: null,
      candidateReason: "Источник указал неизвестное название ЖК",
      candidateConfidence: null,
      sourceRevisionId: null,
    };
    await expect(listingDevelopmentLinkCommands.createCandidate(projectJob(setup.organizationId, `foreign-${suffix}`), input))
      .rejects.toThrow("LISTING_DEVELOPMENT_ACCESS_DENIED");
    const candidate = await listingDevelopmentLinkCommands.createCandidate(projectJob(setup.organizationId, setup.projectId), input);
    await expect(listingDevelopmentLinkCommands.decide(principal, {
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      linkId: candidate.linkId,
      version: 1,
      decision: "CONFIRMED",
    })).rejects.toThrow("LISTING_DEVELOPMENT_DECISION_INVALID");
    await expect(listingDevelopmentLinkCommands.decide(principal, {
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      linkId: candidate.linkId,
      version: 1,
      decision: "REJECTED",
    })).resolves.toMatchObject({ status: "REJECTED", version: 2 });
  });
});
