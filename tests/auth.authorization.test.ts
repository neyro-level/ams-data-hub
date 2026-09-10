import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, SystemRole } from "../src/generated/prisma/client.ts"
import { createLocalAccountIssuer } from "better-auth/db";
import { hashPassword } from "better-auth/crypto";
import { Pool } from "pg";
import { ProjectService } from "../src/modules/project-registry/index.ts";
import { PrismaProjectRepository } from "../src/modules/project-registry/server.ts";
import { getPrincipalStateByUserId } from "../src/platform/authorization/principal-factories.ts";
import { createPgPoolConfigFromEnvironment } from "../src/platform/database/prisma/pool-config.ts";
import {
  hasPermission,
  type PrincipalContext,
} from "../src/platform/authorization/principal.ts";

const authTestDatabaseUrl = process.env.AUTH_TEST_DATABASE_URL ?? null;
const authTestDatabaseHost =
  process.env.AUTH_TEST_DATABASE_HOST ?? process.env.TEST_DATABASE_HOST ?? null;
const authTestDatabasePort =
  process.env.AUTH_TEST_DATABASE_PORT ?? process.env.TEST_DATABASE_PORT ?? null;
const authTestDatabaseUser =
  process.env.AUTH_TEST_DATABASE_USER ?? process.env.TEST_DATABASE_USER ?? null;
const authTestDatabasePassword =
  process.env.AUTH_TEST_DATABASE_PASSWORD ?? process.env.TEST_DATABASE_PASSWORD ?? null;
const authTestDatabaseName =
  process.env.AUTH_TEST_DATABASE_NAME ?? process.env.TEST_DATABASE_NAME ?? null;
const authTestDatabaseSslMode =
  process.env.AUTH_TEST_DATABASE_SSLMODE ?? process.env.TEST_DATABASE_SSLMODE ?? null;
const authTestEnabled =
  authTestDatabaseUrl !== null ||
  Boolean(
    authTestDatabaseHost &&
      authTestDatabaseUser &&
      authTestDatabasePassword &&
      authTestDatabaseName,
  );
const authTestDescription = authTestEnabled ? describe : describe.skip;

const authTestEmails = {
  platformAdmin: "platform-admin-test@seo-monitor.local",
  analyst: "analyst-test@seo-monitor.local",
  alphaViewer: "client-alpha-test@seo-monitor.local",
  westViewer: "client-west-test@seo-monitor.local",
  disabledViewer: "client-disabled-test@seo-monitor.local",
} as const;

let prisma: PrismaClient | null = null;
let pool: Pool | null = null;
let platformAdminUser: PrincipalContext | null = null;
let analystUser: PrincipalContext | null = null;
let alphaViewerUser: PrincipalContext | null = null;
let westViewerUser: PrincipalContext | null = null;
let disabledViewerId: string | null = null;
const projectService = new ProjectService(new PrismaProjectRepository());

async function ensureCredentialUser(email: string, name: string, systemRole: SystemRole) {
  if (!prisma) {
    throw new Error("Prisma test client is not initialized");
  }

  const passwordHash = await hashPassword(`pw-${email}`);
  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  const userId = existingUser?.id ?? randomUUID();

  await prisma.user.upsert({
    where: { email },
    update: {
      name,
      systemRole,
      disabledAt: null,
    },
    create: {
      id: userId,
      email,
      name,
      systemRole,
      emailVerified: false,
    },
  });

  await prisma.account.upsert({
    where: {
      issuer_accountId: {
        issuer: createLocalAccountIssuer("credential"),
        accountId: userId,
      },
    },
    update: {
      userId,
      providerId: "credential",
      password: passwordHash,
    },
    create: {
      id: randomUUID(),
      userId,
      providerId: "credential",
      issuer: createLocalAccountIssuer("credential"),
      accountId: userId,
      password: passwordHash,
    },
  });

  return userId;
}

authTestDescription("authorization matrix", () => {
  beforeAll(async () => {
    pool = new Pool(
      createPgPoolConfigFromEnvironment({
        DATABASE_URL: authTestDatabaseUrl ?? undefined,
        DATABASE_HOST: authTestDatabaseHost ?? undefined,
        DATABASE_PORT: authTestDatabasePort ?? undefined,
        DATABASE_USER: authTestDatabaseUser ?? undefined,
        DATABASE_PASSWORD: authTestDatabasePassword ?? undefined,
        DATABASE_NAME: authTestDatabaseName ?? undefined,
        DATABASE_SSLMODE: authTestDatabaseSslMode ?? undefined,
      }),
    );
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

    const alphaOrganization = await prisma.organization.findUniqueOrThrow({
      where: { slug: "alpha" },
      select: { id: true },
    });
    const westOrganization = await prisma.organization.findUniqueOrThrow({
      where: { slug: "beta" },
      select: { id: true },
    });

    const platformAdminUserId = await ensureCredentialUser(
      authTestEmails.platformAdmin,
      "Platform Admin Test",
      SystemRole.PLATFORM_ADMIN,
    );
    const analystUserId = await ensureCredentialUser(
      authTestEmails.analyst,
      "SEO Analyst Test",
      SystemRole.SEO_ANALYST,
    );
    const alphaViewerId = await ensureCredentialUser(
      authTestEmails.alphaViewer,
      "Alpha Viewer Test",
      SystemRole.CLIENT_VIEWER,
    );
    const westViewerId = await ensureCredentialUser(
      authTestEmails.westViewer,
      "West Viewer Test",
      SystemRole.CLIENT_VIEWER,
    );
    disabledViewerId = await ensureCredentialUser(
      authTestEmails.disabledViewer,
      "Disabled Viewer Test",
      SystemRole.CLIENT_VIEWER,
    );

    await prisma.user.update({
      where: { id: disabledViewerId },
      data: { disabledAt: new Date() },
    });

    await prisma.member.upsert({
      where: {
        organizationId_userId: {
          organizationId: alphaOrganization.id,
          userId: alphaViewerId,
        },
      },
      update: { tenantRole: "VIEWER" },
      create: {
        organizationId: alphaOrganization.id,
        userId: alphaViewerId,
        tenantRole: "VIEWER",
      },
    });

    await prisma.member.upsert({
      where: {
        organizationId_userId: {
          organizationId: westOrganization.id,
          userId: westViewerId,
        },
      },
      update: { tenantRole: "VIEWER" },
      create: {
        organizationId: westOrganization.id,
        userId: westViewerId,
        tenantRole: "VIEWER",
      },
    });

    platformAdminUser = (await getPrincipalStateByUserId(platformAdminUserId, {
      correlationId: "00000000-0000-4000-8000-000000000010",
    }))?.principal ?? null;
    analystUser = (await getPrincipalStateByUserId(analystUserId, {
      correlationId: "00000000-0000-4000-8000-000000000011",
    }))?.principal ?? null;
    alphaViewerUser = (await getPrincipalStateByUserId(alphaViewerId, {
      correlationId: "00000000-0000-4000-8000-000000000012",
    }))?.principal ?? null;
    westViewerUser = (await getPrincipalStateByUserId(westViewerId, {
      correlationId: "00000000-0000-4000-8000-000000000013",
    }))?.principal ?? null;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
    if (pool) {
      await pool.end();
    }
  });

  it("returns null for disabled users", async () => {
    expect(disabledViewerId).not.toBeNull();
    expect(await getPrincipalStateByUserId(disabledViewerId!)).toBeNull();
  });

  it("builds platform admin permissions and global access", async () => {
    expect(platformAdminUser).toMatchObject({
      kind: "platform-admin",
      correlationId: "00000000-0000-4000-8000-000000000010",
    });
    expect(hasPermission(platformAdminUser!, "platform:manage")).toBe(true);
    expect(await projectService.getProjectAccessForUser(platformAdminUser!, "alpha")).not.toBeNull();
    expect(await projectService.getProjectAccessForUser(platformAdminUser!, "beta")).not.toBeNull();
  });

  it("allows analyst to read every project", async () => {
    expect(analystUser).not.toBeNull();
    expect(await projectService.getProjectAccessForUser(analystUser!, "alpha")).not.toBeNull();
    expect(await projectService.getProjectAccessForUser(analystUser!, "beta")).not.toBeNull();
  });

  it("loads current memberships and validates active organization", () => {
    expect(alphaViewerUser).toMatchObject({
      kind: "tenant-user",
      organizationId: expect.any(String),
      role: "VIEWER",
    });
    expect(hasPermission(alphaViewerUser!, "project:read:organization")).toBe(true);
    expect(hasPermission(alphaViewerUser!, "report:read:organization")).toBe(true);
  });

  it("allows client viewer only inside own organization project", async () => {
    expect(alphaViewerUser).not.toBeNull();
    expect(await projectService.getProjectAccessForUser(alphaViewerUser!, "alpha")).not.toBeNull();
    expect(await projectService.getProjectAccessForUser(alphaViewerUser!, "beta")).toBeNull();
  });

  it("denies foreign site access for another client viewer", async () => {
    expect(westViewerUser).not.toBeNull();
    expect(await projectService.getSiteAccessForUser(westViewerUser!, "alpha", "north")).toBeNull();
    expect(await projectService.getSiteAccessForUser(westViewerUser!, "beta", "west")).not.toBeNull();
  });
});
