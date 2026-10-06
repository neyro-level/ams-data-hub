import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const persistence = vi.hoisted(() => ({
  session: { findUnique: vi.fn(), updateMany: vi.fn() },
  user: { findUnique: vi.fn() },
}));
const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("../src/platform/auth/auth.ts", () => ({ getAuth: () => ({ api: auth }) }));
vi.mock("../src/platform/database/transaction.ts", () => ({
  createIdentityDatabaseAuthorizationContext: (context: unknown) => context,
  runInAuthorizedDatabaseTransaction: async (_context: unknown, operation: (transaction: typeof persistence) => unknown) => operation(persistence),
}));

import { requireCurrentCabinetPrincipal } from "../src/platform/auth/principal-session.ts";

const freshSession = () => ({ userId: "admin", expiresAt: new Date(Date.now() + 60_000), activeOrganizationId: null, user: { disabledAt: null } });
const enabledAdmin = () => ({ id: "admin", name: "Synthetic admin", systemRole: "PLATFORM_ADMIN", disabledAt: null, setupTokens: [], members: [], projectMembers: [] });

beforeEach(() => {
  vi.clearAllMocks();
  auth.getSession.mockResolvedValue({ user: { id: "admin" }, session: { id: "session" } });
  persistence.session.findUnique.mockResolvedValue(freshSession());
  persistence.user.findUnique.mockResolvedValue(enabledAdmin());
});

describe("fresh current-release principal without factor state", () => {
  it("never prerenders session-dependent organization selection without auth configuration", () => {
    expect(readFileSync("src/app/organization/page.tsx", "utf8")).toContain('export const dynamic = "force-dynamic"');
  });
  it("accepts an enabled admin only after fresh persisted session resolution", async () => {
    await expect(requireCurrentCabinetPrincipal()).resolves.toMatchObject({ kind: "platform-admin", userId: "admin" });
    expect(auth.getSession).toHaveBeenCalledWith(expect.objectContaining({ query: { disableCookieCache: true } }));
    expect(persistence.session.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "session" } }));
  });

  it.each([null, { ...freshSession(), expiresAt: new Date(0) }, { ...freshSession(), userId: "other" }])("denies revoked, expired or identity-mismatched sessions", async (session) => {
    persistence.session.findUnique.mockResolvedValue(session);
    await expect(requireCurrentCabinetPrincipal()).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
    expect(persistence.user.findUnique).not.toHaveBeenCalled();
  });

  it("denies a disabled admin on the next request", async () => {
    persistence.session.findUnique.mockResolvedValue({ ...freshSession(), user: { disabledAt: new Date() } });
    persistence.user.findUnique.mockResolvedValue({ ...enabledAdmin(), disabledAt: new Date() });
    await expect(requireCurrentCabinetPrincipal()).rejects.toMatchObject({ code: "CABINET_USER_INACTIVE" });
  });

  it("retains incomplete account setup denial", async () => {
    persistence.user.findUnique.mockResolvedValue({ ...enabledAdmin(), setupTokens: [{ id: "pending" }] });
    await expect(requireCurrentCabinetPrincipal()).rejects.toMatchObject({ code: "CABINET_USER_INACTIVE" });
  });

  it("does not grant platform authority to a user without membership", async () => {
    persistence.user.findUnique.mockResolvedValue({ ...enabledAdmin(), systemRole: "USER" });
    await expect(requireCurrentCabinetPrincipal()).rejects.toMatchObject({ code: "CABINET_USER_INACTIVE" });
  });
});
