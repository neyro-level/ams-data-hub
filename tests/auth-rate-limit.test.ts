import { describe, expect, it } from "vitest";
import { createAuthRateLimitConfig } from "../src/platform/auth/security-config.ts";

describe("Better Auth rate-limit contract", () => {
  it("explicitly enables strict rules for the installed login endpoints", () => {
    const config = createAuthRateLimitConfig();

    expect(config.enabled).toBe(true);
    expect(config.storage).toBe("memory");
    expect(config.customRules).toMatchObject({
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-in/username": { window: 60, max: 5 },
    });
  });
});
