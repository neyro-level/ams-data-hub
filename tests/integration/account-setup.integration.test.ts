import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  completeAccountSetup,
  completePlatformRecovery,
} from "../../src/modules/identity-access/server.ts";
import { getPrincipalStateByUserId } from "../../src/platform/authorization/principal-factories.ts";
import { getPrismaClient } from "../../src/platform/database/prisma/client.ts";

const userId = "integration-account-setup-user";
const token = "integration-setup-token-must-be-long-enough";

afterEach(async () => {
  const prisma = getPrismaClient();
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.organization.deleteMany({ where: { slug: { in: ["principal-first", "principal-second"] } } });
});

describe("account setup token lifecycle", () => {
  it("consumes a setup token once, revokes siblings and terminates old sessions", async () => {
    const prisma = getPrismaClient();
    const now = new Date();
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await prisma.user.create({
      data: {
        id: userId,
        name: "Setup user",
        username: "setup_user",
        email: "setup-user@example.test",
        accounts: { create: { id: "setup-account", accountId: userId, providerId: "credential", password: "legacy" } },
        sessions: { create: { id: "setup-session", token: "setup-session-token", expiresAt: new Date(Date.now() + 60_000) } },
        setupTokens: {
          create: [
            { tokenHash, expiresAt: new Date(Date.now() + 60_000) },
            { tokenHash: "sibling-token-hash", expiresAt: new Date(Date.now() + 60_000) },
          ],
        },
      },
    });

    await expect(completeAccountSetup({ token, password: "A longer setup password" })).resolves.toEqual({ userId });
    await expect(completeAccountSetup({ token, password: "A longer setup password" })).resolves.toBeNull();

    const result = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { setupCompletedAt: true, sessions: true, setupTokens: { select: { tokenHash: true, consumedAt: true, revokedAt: true } } },
    });
    expect(result.setupCompletedAt).not.toBeNull();
    expect(result.sessions).toHaveLength(0);
    expect(result.setupTokens.find((item) => item.tokenHash === tokenHash)?.consumedAt).not.toBeNull();
    expect(result.setupTokens.find((item) => item.tokenHash === "sibling-token-hash")?.revokedAt).not.toBeNull();
    expect(result.setupCompletedAt!.getTime()).toBeGreaterThanOrEqual(now.getTime());
  });
});

describe("platform recovery token lifecycle", () => {
  it("consumes recovery once and revokes sessions and the old second factor", async () => {
    const prisma = getPrismaClient();
    const recoveryToken = "integration-recovery-token-must-be-long-enough";
    const tokenHash = createHash("sha256").update(recoveryToken).digest("hex");
    await prisma.user.create({
      data: {
        id: userId, name: "Recovery user", username: "recovery_user", email: "recovery-user@example.test", systemRole: "PLATFORM_ADMIN", twoFactorEnabled: true,
        accounts: { create: { id: "recovery-account", accountId: userId, providerId: "credential", password: "legacy" } },
        sessions: { create: { id: "recovery-session", token: "recovery-session-token", expiresAt: new Date(Date.now() + 60_000), twoFactorVerifiedAt: new Date() } },
        twoFactors: { create: { id: "recovery-factor", secret: "secret", backupCodes: "[]" } },
        recoveryTokens: { create: { tokenHash, expiresAt: new Date(Date.now() + 60_000) } },
      },
    });

    await expect(completePlatformRecovery({ token: recoveryToken, password: "A recovered secure password" })).resolves.toEqual({ userId });
    await expect(completePlatformRecovery({ token: recoveryToken, password: "A recovered secure password" })).resolves.toBeNull();
    const result = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { twoFactorEnabled: true, sessions: true, twoFactors: true, recoveryTokens: true } });
    expect(result.twoFactorEnabled).toBe(false);
    expect(result.sessions).toHaveLength(0);
    expect(result.twoFactors).toHaveLength(0);
    expect(result.recoveryTokens[0]?.consumedAt).not.toBeNull();
  });
});

describe("fresh principal enforcement", () => {
  it("denies a password-only platform admin and a multi-membership user without an explicit organization", async () => {
    const prisma = getPrismaClient();
    const firstOrganization = await prisma.organization.create({ data: { slug: "principal-first", name: "Principal first" } });
    const secondOrganization = await prisma.organization.create({ data: { slug: "principal-second", name: "Principal second" } });
    await prisma.user.create({
      data: {
        id: userId,
        name: "Principal user",
        username: "principal_user",
        email: "principal-user@example.test",
        systemRole: "PLATFORM_ADMIN",
      },
    });

    await expect(getPrincipalStateByUserId(userId, { platformAdminMfaVerified: false })).resolves.toBeNull();
    await expect(getPrincipalStateByUserId(userId, { platformAdminMfaVerified: true })).resolves.toMatchObject({
      principal: { kind: "platform-admin", userId },
    });

    await prisma.accountSetupToken.create({
      data: {
        userId,
        tokenHash: "fresh-principal-setup-gate",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await expect(getPrincipalStateByUserId(userId, { platformAdminMfaVerified: true })).resolves.toBeNull();
    await prisma.accountSetupToken.updateMany({
      where: { userId },
      data: { revokedAt: new Date() },
    });

    await prisma.user.update({ where: { id: userId }, data: { disabledAt: new Date() } });
    await expect(getPrincipalStateByUserId(userId, { platformAdminMfaVerified: true })).resolves.toBeNull();
    await prisma.user.update({ where: { id: userId }, data: { disabledAt: null } });

    await prisma.user.update({ where: { id: userId }, data: { systemRole: "MEMBER" } });
    await prisma.member.createMany({
      data: [
        { organizationId: firstOrganization.id, userId, tenantRole: "VIEWER" },
        { organizationId: secondOrganization.id, userId, tenantRole: "ORG_MEMBER" },
      ],
    });
    await expect(getPrincipalStateByUserId(userId)).resolves.toBeNull();
    await expect(getPrincipalStateByUserId(userId, { selectedOrganizationId: secondOrganization.id })).resolves.toMatchObject({
      principal: { kind: "tenant-user", organizationId: secondOrganization.id, userId },
    });
  });
});
