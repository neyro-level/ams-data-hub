import { createPrismaContext } from "../src/platform/database/prisma/context.ts";

async function seedTestDatabase() {
  const database = createPrismaContext(process.env);
  try {
    const organization = await database.prisma.organization.findUniqueOrThrow({
      where: { slug: "ams-data-hub" },
      select: { id: true },
    });
    const user = await database.prisma.user.upsert({
      where: { email: "integration-platform-admin@example.test" },
      update: { disabledAt: null, systemRole: "PLATFORM_ADMIN" },
      create: {
        id: "integration-platform-admin",
        name: "Integration Platform Admin",
        username: "integration_platform_admin",
        email: "integration-platform-admin@example.test",
        systemRole: "PLATFORM_ADMIN",
      },
      select: { id: true },
    });
    await database.prisma.member.upsert({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId: user.id,
        },
      },
      update: { tenantRole: "ORG_ADMIN" },
      create: {
        organizationId: organization.id,
        userId: user.id,
        tenantRole: "ORG_ADMIN",
      },
    });
    process.stdout.write("test_database_seed=complete\n");
  } finally {
    await database.close();
  }
}

seedTestDatabase().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Test seed failed"}\n`);
  process.exit(1);
});
