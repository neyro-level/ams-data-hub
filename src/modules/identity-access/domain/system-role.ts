export type SystemRole = "PLATFORM_ADMIN" | "USER";

export function parseSystemRole(value: string): SystemRole {
  if (
    value === "PLATFORM_ADMIN" ||
    value === "USER"
  ) {
    return value;
  }

  throw new Error(`Unsupported system role: ${value}`);
}
