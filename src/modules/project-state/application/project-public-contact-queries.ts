import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { runInPrincipalDatabaseTransaction, runInProjectPrincipalDatabaseTransaction } from "../../../platform/database/transaction.ts";
import { projectPublicContactQuerySchema, type ProjectPublicContactAdminItem, type ProjectPublicContactDto, type ProjectPublicContactQuery } from "../contracts.ts";
import { ProjectStateError } from "../domain/project-state-error.ts";
import { requireProjectContactReader, requireProjectStateAdmin } from "./project-state-authorization.ts";

const contactSelect = {
  organizationId: true,
  projectId: true,
  phone: true,
  email: true,
  addressPublic: true,
  messengers: true,
  hours: true,
  version: true,
} as const;

function publicDto(contact: { phone: string; email: string | null; addressPublic: string | null; messengers: unknown; hours: string | null }): ProjectPublicContactDto {
  return {
    phone: contact.phone,
    email: contact.email,
    addressPublic: contact.addressPublic,
    messengers: Array.isArray(contact.messengers) ? contact.messengers.filter((value): value is string => typeof value === "string") : [],
    hours: contact.hours,
  };
}

export async function getProjectPublicContact(principal: PrincipalContext, rawQuery: ProjectPublicContactQuery): Promise<ProjectPublicContactDto> {
  const query = projectPublicContactQuerySchema.parse(rawQuery);
  requireProjectContactReader(principal, query.organizationId);
  return runInProjectPrincipalDatabaseTransaction(principal, query.projectId, async (transaction) => {
    const contact = await transaction.projectPublicContact.findUnique({ where: { organizationId_projectId: query }, select: contactSelect });
    if (!contact) throw new ProjectStateError("PROJECT_PUBLIC_CONTACT_NOT_FOUND");
    return publicDto(contact);
  });
}

export async function listProjectPublicContactsForAdmin(principal: PrincipalContext, projectIds: string[]): Promise<ProjectPublicContactAdminItem[]> {
  requireProjectStateAdmin(principal);
  if (projectIds.length === 0) return [];
  return runInPrincipalDatabaseTransaction(principal, async (transaction) => {
    const contacts = await transaction.projectPublicContact.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: { projectId: "asc" },
      select: contactSelect,
    });
    return contacts.map((contact) => ({
      organizationId: contact.organizationId,
      projectId: contact.projectId,
      version: contact.version,
      ...publicDto(contact),
    }));
  });
}
