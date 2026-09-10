import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import {
  createActionBoundary,
  type ActionBoundaryDependencies,
} from "../src/platform/actions/define-action.ts";
import type {
  PlatformAdminPrincipal,
  TenantUserPrincipal,
} from "../src/platform/authorization/principal.ts";
import { CabinetPrincipalError } from "../src/platform/auth/principal-session.ts";

const correlationId = "00000000-0000-4000-8000-000000000081";
const admin: PlatformAdminPrincipal = {
  kind: "platform-admin",
  userId: "admin-action",
  correlationId,
};
const tenant: TenantUserPrincipal = {
  kind: "tenant-user",
  userId: "tenant-action",
  organizationId: "organization-action",
  membershipId: "membership-action",
  role: "VIEWER",
  correlationId,
};

function boundary(overrides: Partial<ActionBoundaryDependencies> = {}) {
  const dependencies: ActionBoundaryDependencies = {
    requireCabinetPrincipal: async () => admin,
    revalidate: vi.fn(),
    ...overrides,
  };
  return { defineAction: createActionBoundary(dependencies), dependencies };
}

describe("defineAction", () => {
  it("injects the current admin and revalidates only after success", async () => {
    const { defineAction, dependencies } = boundary();
    const action = defineAction<{ value: string }, { saved: string }>({
      execute: async ({ principal, input }) => ({
        saved: `${principal.kind === "platform-admin" ? principal.userId : "wrong"}:${input.value}`,
      }),
      revalidate: [{ path: "/admin", type: "layout" }],
    });

    await expect(action({ value: "ok" })).resolves.toEqual({
      ok: true,
      data: { saved: "admin-action:ok" },
    });
    expect(dependencies.revalidate).toHaveBeenCalledWith("/admin", "layout");
  });

  it.each([
    ["disabled user", "CABINET_USER_INACTIVE"],
    ["direct call without a session", "AUTHENTICATION_REQUIRED"],
  ] as const)("returns a safe envelope for %s", async (_caseName, code) => {
    const { defineAction, dependencies } = boundary({
      requireCabinetPrincipal: async () => {
        throw new CabinetPrincipalError(code);
      },
    });
    const action = defineAction<undefined, never>({
      execute: async () => {
        throw new Error("must not execute");
      },
      revalidate: [{ path: "/admin" }],
    });

    const result = await action(undefined);
    expect(result).toMatchObject({ ok: false, code, fieldErrors: {} });
    expect(result).not.toHaveProperty("stack");
    expect(dependencies.revalidate).not.toHaveBeenCalled();
  });

  it("passes a tenant principal to business authorization without escalating it", async () => {
    const { defineAction } = boundary({ requireCabinetPrincipal: async () => tenant });
    const action = defineAction<undefined, never>({
      execute: async ({ principal }) => {
        expect(principal).toBe(tenant);
        throw new Error("PROJECT_ACCESS_DENIED");
      },
      mapError: () => ({
        code: "PROJECT_ACCESS_DENIED",
        message: "Недостаточно прав.",
      }),
    });

    await expect(action(undefined)).resolves.toMatchObject({
      ok: false,
      code: "PROJECT_ACCESS_DENIED",
      correlationId,
    });
  });

  it("maps validation details and hides unexpected errors", async () => {
    const { defineAction } = boundary();
    const invalid = defineAction<{ name: string }, never>({
      execute: async ({ input }) => {
        z.object({ name: z.string().min(3) }).parse(input);
        throw new Error("unreachable");
      },
      inputError: { code: "INPUT_INVALID", message: "Проверьте поля." },
    });
    const unexpected = defineAction<undefined, never>({
      execute: async () => {
        throw new Error("database password must stay hidden");
      },
    });

    await expect(invalid({ name: "x" })).resolves.toMatchObject({
      ok: false,
      code: "INPUT_INVALID",
      fieldErrors: { name: expect.any(Array) },
    });
    await expect(unexpected(undefined)).resolves.toMatchObject({
      ok: false,
      code: "ACTION_FAILED",
      message: "Не удалось выполнить действие.",
    });
  });
});
