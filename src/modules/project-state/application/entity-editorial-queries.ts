import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { runInProjectPrincipalDatabaseTransaction } from "../../../platform/database/transaction.ts";
import { projectPublicContactQuerySchema, type ProjectEditorialPublicDto, type ProjectPublicContactQuery } from "../contracts.ts";
import { mapProjectEditorialPublic } from "./project-editorial-mapper.ts";
import { requireProjectContactReader } from "./project-state-authorization.ts";

export async function listProjectEditorialPublic(
  principal: PrincipalContext,
  rawQuery: ProjectPublicContactQuery,
): Promise<ProjectEditorialPublicDto[]> {
  const query = projectPublicContactQuerySchema.parse(rawQuery);
  requireProjectContactReader(principal, query.organizationId);
  return runInProjectPrincipalDatabaseTransaction(principal, query.projectId, async (transaction) => {
    const editorialRows = await transaction.entityEditorial.findMany({
      where: { organizationId: query.organizationId, projectId: query.projectId },
      orderBy: [{ entityType: "asc" }, { entityUid: "asc" }],
    });
    const policyRows = await transaction.entityMediaOrderPolicy.findMany({
      where: { organizationId: query.organizationId, projectId: query.projectId },
    });
    const policies = new Map(policyRows.map((policy) => [`${policy.entityType}:${policy.entityUid}`, policy]));
    return editorialRows.map((editorial) => mapProjectEditorialPublic(
      {
        ...editorial,
        faq: Array.isArray(editorial.faq) ? editorial.faq as Array<{ question: string; answer: string }> : [],
      },
      policies.get(`${editorial.entityType}:${editorial.entityUid}`) ?? null,
    ));
  });
}
