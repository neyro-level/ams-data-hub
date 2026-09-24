import { describe, expect, it } from "vitest";
import { getPrismaClient } from "../../src/platform/database/prisma/client.ts";

describe("PostgreSQL test foundation", () => {
  it("runs against PostgreSQL 18 with neutral bootstrap identities", async () => {
    const prisma = getPrismaClient();
    const [database] = await prisma.$queryRaw<
      Array<{ current_database: string; current_user: string; server_version: string }>
    >`select current_database(), current_user, current_setting('server_version') as server_version`;

    expect(database.current_database).toBe(process.env.TEST_DATABASE_NAME);
    expect(database.current_user).toBe(process.env.TEST_DATABASE_USER);
    expect(Number.parseInt(database.server_version, 10)).toBe(18);

    const organization = await prisma.organization.findUniqueOrThrow({
      where: { slug: "ams-start" },
      select: { id: true },
    });
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: "integration-platform-admin@example.test" },
      select: { id: true, systemRole: true, disabledAt: true },
    });
    const membership = await prisma.member.findUniqueOrThrow({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId: user.id,
        },
      },
      select: { tenantRole: true },
    });

    expect(user).toMatchObject({ systemRole: "PLATFORM_ADMIN", disabledAt: null });
    expect(membership.tenantRole).toBe("ORG_OWNER");
  });
});
