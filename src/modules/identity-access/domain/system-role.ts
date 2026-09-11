export type SystemRole = "PLATFORM_ADMIN" | "STAFF" | "MEMBER";

export function parseSystemRole(value: string): SystemRole {
  if (
    value === "PLATFORM_ADMIN" ||
    value === "STAFF" ||
    value === "MEMBER"
  ) {
    return value;
  }

  throw new Error(`Unsupported system role: ${value}`);
}
