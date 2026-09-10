import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { createLocalAccountIssuer } from "better-auth/db";
import { getPrismaClient } from "../src/platform/database/prisma/client.ts";

const E2E_PASSWORD = "E2e!2026";
const CLIENT_USERNAMES = [
  "e2e.client.mobile",
  "e2e.client.tablet",
  "e2e.client.desktop1280",
  "e2e.client.desktop1440",
] as const;
const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);

async function main() {
  if (process.argv[2] !== "--confirm-local-e2e") {
    throw new Error("Explicit local E2E confirmation is required");
  }
  if (!process.env.DATABASE_HOST || !localHosts.has(process.env.DATABASE_HOST)) {
    throw new Error("E2E identity seed is restricted to a loopback PostgreSQL host");
  }

  const prisma = getPrismaClient();
  try {
    const issuer = createLocalAccountIssuer("credential");
    const passwordHash = await hashPassword(E2E_PASSWORD);
    const provisionUser = async (input: {
      username: string;
      email: string;
      name: string;
      systemRole: "PLATFORM_ADMIN" | "CLIENT_VIEWER";
    }) => {
      const existing = await prisma.user.findUnique({
        where: { email: input.email },
        select: { id: true },
      });
      const userId = existing?.id ?? randomUUID();
      await prisma.user.upsert({
        where: { email: input.email },
        update: {
          name: input.name,
          username: input.username,
          systemRole: input.systemRole,
          disabledAt: null,
        },
        create: {
          id: userId,
          email: input.email,
          username: input.username,
          name: input.name,
          systemRole: input.systemRole,
          emailVerified: false,
        },
      });
      await prisma.account.upsert({
        where: { issuer_accountId: { issuer, accountId: userId } },
        update: { userId, providerId: "credential", password: passwordHash },
        create: {
          id: randomUUID(),
          userId,
          providerId: "credential",
          issuer,
          accountId: userId,
          password: passwordHash,
        },
      });
      return userId;
    };

    await provisionUser({
      username: "e2e.platform.admin",
      email: "e2e-platform-admin@example.invalid",
      name: "E2E Platform Admin",
      systemRole: "PLATFORM_ADMIN",
    });

    const organization = await prisma.organization.findUniqueOrThrow({
      where: { slug: "alpha" },
      select: { id: true },
    });
    for (const username of CLIENT_USERNAMES) {
      const userId = await provisionUser({
        username,
        email: `${username}@example.invalid`,
        name: `E2E ${username}`,
        systemRole: "CLIENT_VIEWER",
      });
      await prisma.member.upsert({
        where: {
          organizationId_userId: { organizationId: organization.id, userId },
        },
        update: { tenantRole: "VIEWER" },
        create: {
          organizationId: organization.id,
          userId,
          tenantRole: "VIEWER",
        },
      });
    }
    console.log(JSON.stringify({ seeded: true, identityCount: 1 + CLIENT_USERNAMES.length }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "E2E identity seed failed");
  process.exitCode = 1;
});
