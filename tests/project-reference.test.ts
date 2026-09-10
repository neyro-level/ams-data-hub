import { describe, expect, it } from "vitest";
import {
  requireProjectForAction,
} from "../src/modules/project-registry/index.ts";
import {
  createProjectInputSchema,
  nextProjectVersion,
} from "../src/modules/project-registry/domain/project.ts";
import type { ProjectReferenceRepository } from "../src/modules/project-registry/application/ports/project-reference-repository.ts";
import type { PrincipalContext } from "../src/platform/authorization/principal.ts";

const project = {
  id: "project-a",
  organizationId: "organization-a",
  name: "Project A",
  slug: "project-a",
  status: "ACTIVE" as const,
  thresholdProfileId: "threshold-a",
  clusterProfileId: "cluster-a",
  version: 3,
};

const repository: ProjectReferenceRepository = {
  findForAction: async (projectId) => projectId === project.id ? project : null,
  create: async () => ({ id: project.id, version: 1 }),
  updateStatus: async () => true,
  updateSettings: async () => true,
  appendAudit: async () => undefined,
};

const owner: PrincipalContext = {
  kind: "tenant-user",
  userId: "owner-a",
  membershipId: "membership-a",
  organizationId: "organization-a",
  role: "ORG_OWNER",
  correlationId: "00000000-0000-4000-8000-000000000401",
};
const foreignOwner: PrincipalContext = {
  ...owner,
  userId: "owner-b",
  membershipId: "membership-b",
  organizationId: "organization-b",
};


describe("Project reference domain", () => {
  it("normalizes canonical create input and advances a valid version", () => {
    expect(createProjectInputSchema.parse({
      organizationId: " organization-a ",
      slug: "project-a",
      name: " Project A ",
      status: "PLANNED",
      thresholdProfileId: "threshold-a",
      clusterProfileId: "cluster-a",
    })).toMatchObject({ organizationId: "organization-a", name: "Project A" });
    expect(nextProjectVersion(3)).toBe(4);
  });

  it("rejects malformed slugs and invalid concurrency versions", () => {
    expect(() => createProjectInputSchema.parse({
      organizationId: "organization-a",
      slug: "Project A",
      name: "Project A",
      status: "PLANNED",
      thresholdProfileId: "threshold-a",
      clusterProfileId: "cluster-a",
    })).toThrow();
    expect(() => nextProjectVersion(0)).toThrow("PROJECT_STALE");
  });

  it("loads an owned project for an authorized tenant owner", async () => {
    await expect(requireProjectForAction(
      owner,
      "organization-a",
      "project-a",
      repository,
    )).resolves.toMatchObject({ project: { id: "project-a" } });
  });

  it("denies foreign tenant scope before loading a resource", async () => {
    await expect(requireProjectForAction(
      foreignOwner,
      "organization-a",
      "project-a",
      repository,
    )).rejects.toMatchObject({ code: "PROJECT_ACCESS_DENIED" });
  });

  it("does not disclose a missing or foreign resource", async () => {
    await expect(requireProjectForAction(
      owner,
      "organization-a",
      "missing",
      repository,
    )).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND_OR_FORBIDDEN" });
  });
});
