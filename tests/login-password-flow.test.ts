import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("current-release login presentation", () => {
  const login = readFileSync("src/modules/identity-access/presentation/LoginDialog.tsx", "utf8");

  it("uses a single username/password form without factor challenge branches", () => {
    expect(login.match(/<form\b/g)).toHaveLength(1);
    expect(login).toContain("authClient.signIn.username({ username, password, rememberMe: true })");
    expect(login).not.toMatch(/twoFactor|[tT]otp|one-time-code|аутентификатора/);
    expect(login).toContain('router.replace("/dashboard/")');
  });

  it("retains accessible controls and loading/error behavior", () => {
    expect(login).toContain('autoComplete="username"');
    expect(login).toContain('autoComplete="current-password"');
    expect(login).toContain('role="alert"');
    expect(login).toContain("disabled={pending}");
    expect(login).toContain("showCloseButton={!pending}");
    expect(login).toContain("if (!nextOpen && pending) return;");
    expect(login.match(/<label\b/g)).toHaveLength(2);
  });
});
