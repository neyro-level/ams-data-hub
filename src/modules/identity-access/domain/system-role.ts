export type SystemRole = "PLATFORM_ADMIN" | "SEO_ANALYST" | "CLIENT_VIEWER";

export function parseSystemRole(value: string): SystemRole {
  if (
    value === "PLATFORM_ADMIN" ||
    value === "SEO_ANALYST" ||
    value === "CLIENT_VIEWER"
  ) {
    return value;
  }

  throw new Error(`Unsupported system role: ${value}`);
}
