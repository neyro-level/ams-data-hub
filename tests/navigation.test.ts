import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaContext } from "../src/platform/database/prisma/context.ts";
import { buildNavigation } from "../src/modules/project-registry/presentation.ts";
import { getPrincipalStateByUserId } from "../src/platform/authorization/principal-factories.ts";
import type { PrincipalContext } from "../src/platform/authorization/principal.ts";
import { createPlatformAnalystPrincipal } from "./helpers/principal.ts";

const navigationTestEnabled = Boolean(
  process.env.DATABASE_HOST &&
    process.env.DATABASE_USER &&
    process.env.DATABASE_PASSWORD &&
    process.env.DATABASE_NAME,
);
const navigationTestDescription = navigationTestEnabled ? describe : describe.skip;

const analystPrincipal = createPlatformAnalystPrincipal("analyst-1");

const clientViewerIdentity = {
  userId: "navigation-viewer-1",
  email: "viewer@test.local",
  name: "Viewer",
};

navigationTestDescription("database-backed navigation isolation", () => {
  let database: ReturnType<typeof createPrismaContext> | null = null;
  let clientViewerPrincipal: PrincipalContext | null = null;

  beforeAll(async () => {
    database = createPrismaContext({
      DATABASE_URL: process.env.DATABASE_URL,
      DATABASE_HOST: process.env.DATABASE_HOST,
      DATABASE_PORT: process.env.DATABASE_PORT,
      DATABASE_USER: process.env.DATABASE_USER,
      DATABASE_PASSWORD: process.env.DATABASE_PASSWORD,
      DATABASE_NAME: process.env.DATABASE_NAME,
      DATABASE_SSLMODE: process.env.DATABASE_SSLMODE,
    });
    const organization = await database.prisma.organization.findUniqueOrThrow({
      where: { slug: "alpha" },
      select: { id: true },
    });
    await database.prisma.user.upsert({
      where: { id: clientViewerIdentity.userId },
      update: { disabledAt: null, systemRole: "CLIENT_VIEWER" },
      create: {
        id: clientViewerIdentity.userId,
        email: clientViewerIdentity.email,
        name: clientViewerIdentity.name,
        emailVerified: false,
        systemRole: "CLIENT_VIEWER",
      },
    });
    await database.prisma.member.upsert({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId: clientViewerIdentity.userId,
        },
      },
      update: { tenantRole: "VIEWER" },
      create: {
        organizationId: organization.id,
        userId: clientViewerIdentity.userId,
        tenantRole: "VIEWER",
      },
    });
    clientViewerPrincipal = (await getPrincipalStateByUserId(clientViewerIdentity.userId, {
      correlationId: "00000000-0000-4000-8000-000000000002",
    }))?.principal ?? null;
    if (!clientViewerPrincipal) throw new Error("Missing client viewer PrincipalContext");
  });

  afterAll(async () => {
    if (!database) return;
    await database.prisma.member.deleteMany({ where: { userId: clientViewerIdentity.userId } });
    await database.prisma.user.deleteMany({ where: { id: clientViewerIdentity.userId } });
    await database.close();
  });
  it("keeps all available projects visible on a client route", async () => {
    const sections = await buildNavigation("/c/alpha/north/", clientViewerPrincipal!);
    const items = sections.flatMap((section) => section.items);

    expect(sections).toHaveLength(2);
    expect(items.map((item) => item.label)).toEqual([
      "Мои проекты",
      "Synthetic Alpha Organization",
    ]);
    expect(items[1]?.children?.map((item) => item.label)).toEqual([
      "Synthetic site 2",
      "Synthetic site 1",
      "Synthetic site 3",
    ]);
    expect(JSON.stringify(sections)).not.toContain("Synthetic Beta Organization");
    expect(items[0]?.active).toBe(false);
  });

  it("renders all projects directly on the analyst root", async () => {
    const sections = await buildNavigation("/analyst/", analystPrincipal);
    const serialized = JSON.stringify(sections);
    const mainItems = sections[0]?.items ?? [];
    const projectItems = sections[1]?.items ?? [];

    expect(sections[0]?.title).toBe("");
    expect(mainItems.map((item) => item.label)).toEqual(["Все проекты", "Уведомления"]);
    expect(mainItems[0]?.active).toBe(true);
    expect(projectItems.map((item) => item.label)).toEqual([
      "Synthetic Alpha Organization",
      "Synthetic Beta Organization",
    ]);
    expect(serialized).not.toContain("Общий кабинет");
  });
});
