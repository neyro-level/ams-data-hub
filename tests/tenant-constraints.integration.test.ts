import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaContext, type PrismaContext } from "../src/platform/database/prisma/context.ts";

const integrationEnabled = Boolean(
  process.env.TEST_DATABASE_HOST &&
    process.env.TEST_DATABASE_USER &&
    process.env.TEST_DATABASE_PASSWORD &&
    process.env.TEST_DATABASE_NAME,
);
const integrationDescription = integrationEnabled ? describe : describe.skip;

integrationDescription("tenant composite constraints", () => {
  let database: PrismaContext;
  let projectA: { id: string; organizationId: string };
  let organizationBId = "";
  let siteA: { id: string; organizationId: string };

  beforeAll(async () => {
    database = createPrismaContext({
      DATABASE_HOST: process.env.TEST_DATABASE_HOST,
      DATABASE_PORT: process.env.TEST_DATABASE_PORT,
      DATABASE_USER: process.env.TEST_DATABASE_USER,
      DATABASE_PASSWORD: process.env.TEST_DATABASE_PASSWORD,
      DATABASE_NAME: process.env.TEST_DATABASE_NAME,
      DATABASE_SSLMODE: process.env.TEST_DATABASE_SSLMODE,
    });
    projectA = await database.prisma.project.findUniqueOrThrow({
      where: { slug: "alpha" },
      select: { id: true, organizationId: true },
    });
    const projectB = await database.prisma.project.findUniqueOrThrow({
      where: { slug: "beta" },
      select: { organizationId: true },
    });
    organizationBId = projectB.organizationId;
    siteA = await database.prisma.site.findFirstOrThrow({
      where: { projectId: projectA.id },
      select: { id: true, organizationId: true },
    });
  });

  afterAll(async () => {
    await database.close();
  });

  it("rejects cross-tenant site-to-project and provider-to-site links", async () => {
    await expect(
      database.prisma.site.create({
        data: {
          organizationId: organizationBId,
          projectId: projectA.id,
          slug: "cross-tenant-site",
          name: "Cross tenant site",
          url: "https://cross-tenant.example.invalid",
          timezone: "Europe/Moscow",
          enabled: false,
        },
      }),
    ).rejects.toThrow();

    await expect(
      database.prisma.providerConnection.create({
        data: {
          organizationId: organizationBId,
          siteId: siteA.id,
          provider: "YANDEX_WEBMASTER",
          enabled: false,
        },
      }),
    ).rejects.toThrow();
  });
});
