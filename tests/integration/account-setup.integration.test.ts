import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { completeAccountSetup } from "../../src/modules/identity-access/application/complete-account-setup.ts";
import { getPrismaClient } from "../../src/platform/database/prisma/client.ts";

const userId = "integration-account-setup-user";
const token = "integration-setup-token-must-be-long-enough";

afterEach(async () => {
  await getPrismaClient().user.deleteMany({ where: { id: userId } });
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
        accounts: { create: { id: "setup-account", issuer: "credential", accountId: userId, providerId: "credential", password: "legacy" } },
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
