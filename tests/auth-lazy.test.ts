import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  betterAuth: vi.fn<(options: unknown) => { api: Record<string, never> }>(() => ({ api: {} })),
  getPrismaClient: vi.fn(() => ({})),
  username: vi.fn(() => ({ id: "username" })),
}));

vi.mock("better-auth", () => ({ betterAuth: authMocks.betterAuth }));
vi.mock("better-auth/adapters/prisma", () => ({ prismaAdapter: vi.fn(() => ({})) }));
vi.mock("better-auth/plugins", () => ({
  username: authMocks.username,
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

  it("uses username/password without a factor plugin while retaining security controls", async () => {
    const authModule = await import("../src/platform/auth/auth.ts");
    authModule.getAuth();
    const options = authMocks.betterAuth.mock.calls[0]?.[0] as {
      plugins: { id: string }[];
      session?: unknown;
      databaseHooks?: unknown;
      emailAndPassword: Record<string, unknown>;
      rateLimit: Record<string, unknown>;
      trustedOrigins: string[];
      advanced: Record<string, unknown>;
    };
    expect(options.plugins).toEqual([{ id: "username" }]);
    expect(options.session).toBeUndefined();
    expect(options.databaseHooks).toBeUndefined();
    expect(options.emailAndPassword).toMatchObject({ enabled: true, disableSignUp: true, minPasswordLength: 12 });
    expect(options.rateLimit).toMatchObject({ enabled: true, storage: "database" });
    expect(options.trustedOrigins).toContain("http://127.0.0.1:3000");
    expect(options.advanced).toHaveProperty("ipAddress");
  });
});
