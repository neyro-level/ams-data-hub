export const CAPABILITIES = [
  "catalog.write",
  "project.editorial.write",
  "source.run",
  "snapshot.publish",
  "agent.consent.record",
  "organization.manage",
  "project.manage",
  "project.read",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export type OrganizationRole = "ORG_ADMIN" | "ORG_EDITOR" | "ORG_VIEWER";
export type ProjectRole = "PROJECT_EDITOR" | "PROJECT_VIEWER";

export const ROLE_CAPABILITIES: Readonly<Record<OrganizationRole, readonly Capability[]>> = {
  ORG_ADMIN: CAPABILITIES,
  ORG_EDITOR: ["project.editorial.write", "source.run", "agent.consent.record", "project.read"],
  ORG_VIEWER: ["project.read"],
};

export function hasCapability(role: OrganizationRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}
