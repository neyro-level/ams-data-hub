import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  betterAuth: vi.fn(() => ({ api: {} })),
  getPrismaClient: vi.fn(() => ({})),
}));

vi.mock("better-auth", () => ({ betterAuth: authMocks.betterAuth }));
vi.mock("better-auth/adapters/prisma", () => ({ prismaAdapter: vi.fn(() => ({})) }));
vi.mock("better-auth/plugins", () => ({
  twoFactor: vi.fn(() => ({})),
  username: vi.fn(() => ({})),
}));
vi.mock("../src/platform/config/server-environment.ts", () => ({
  hasDatabaseConfiguration: vi.fn(() => true),
  readAuthEnvironment: vi.fn(() => ({
    secret: "test-secret-that-is-long-enough-for-better-auth",
    baseUrl: "http://127.0.0.1:3000",
    trustedProxyCidrs: [],
  })),
}));
vi.mock("../src/platform/database/prisma/client.ts", () => ({
  getPrismaClient: authMocks.getPrismaClient,
}));

describe("B9 lazy auth initialization", () => {
  beforeEach(() => {
    vi.resetModules();
    authMocks.betterAuth.mockClear();
    authMocks.getPrismaClient.mockClear();
  });

  it("does not initialize Better Auth while importing the module", async () => {
    const authModule = await import("../src/platform/auth/auth.ts");

    expect(authMocks.betterAuth).not.toHaveBeenCalled();
    expect(authMocks.getPrismaClient).not.toHaveBeenCalled();

    expect(authModule.getAuth()).toBeTruthy();
    expect(authMocks.betterAuth).toHaveBeenCalledTimes(1);
    expect(authMocks.getPrismaClient).toHaveBeenCalledTimes(1);
    expect(authModule.getAuth()).toBeTruthy();
    expect(authMocks.betterAuth).toHaveBeenCalledTimes(1);
  });
});
