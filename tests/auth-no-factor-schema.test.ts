import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { getSchema } from "better-auth/db";
import { username } from "better-auth/plugins";
import { describe, expect, it } from "vitest";

describe("current-release factor schema cleanup", () => {
  it("proves the installed username-only Better Auth schema does not require factor persistence", () => {
    const schema = getSchema({ plugins: [username({ displayUsername: false, immutableUsername: true })] });
    expect(schema.twoFactor).toBeUndefined();
    expect(schema.user?.fields.twoFactorEnabled).toBeUndefined();
    expect(schema.session?.fields.twoFactorVerifiedAt).toBeUndefined();
    expect(schema.user?.fields.username).toBeDefined();
  });

  it("uses only a new forward migration and preserves historical Git migration content", () => {
    const historical = readFileSync("prisma/migrations/20260924113000_identity_hardening/migration.sql", "utf8").replaceAll("\r\n", "\n");
    expect(createHash("sha256").update(historical).digest("hex"))
      .toBe("0b0f24cf7ef2ee3e76700c9efe090b2aad1219a6fde8c311ae71c67a1ee61e6e");
    const migration = readFileSync("prisma/migrations/20261006120000_remove_current_release_totp/migration.sql", "utf8");
    expect(migration).toContain('DROP TABLE "TwoFactor";');
    expect(migration).toContain('ALTER TABLE "User" DROP COLUMN "twoFactorEnabled";');
    expect(migration).toContain('ALTER TABLE "Session" DROP COLUMN "twoFactorVerifiedAt";');
    expect(migration).not.toMatch(/DROP TABLE .*CASCADE|DELETE FROM|DROP SCHEMA/);
    expect(readFileSync("prisma/schema.prisma", "utf8")).not.toMatch(/twoFactor|model TwoFactor/);
  });
});
