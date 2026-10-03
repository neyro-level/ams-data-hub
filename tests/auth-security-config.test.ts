import { describe, expect, it } from "vitest";
import { readAuthEnvironment } from "../src/platform/config/server-environment.ts";
import {
  createAuthIpAddressConfig,
  isTotpVerificationPath,
} from "../src/platform/auth/security-config.ts";

const authEnvironment = {
  BETTER_AUTH_SECRET: "a-secure-test-secret-that-is-longer-than-32-characters",
  BETTER_AUTH_URL: "https://data-hub.example.test",
};

describe("auth network and MFA configuration", () => {
  it("requires an explicit production proxy boundary and never enables an implicit forwarded header", () => {
    expect(() => createAuthIpAddressConfig({ trustedProxyCidrs: [], isProduction: true })).toThrow(
      "BETTER_AUTH_TRUSTED_PROXY_CIDRS",
    );
    expect(createAuthIpAddressConfig({ trustedProxyCidrs: [], isProduction: false })).toEqual({
      ipAddressHeaders: [],
      trustedProxies: [],
    });
    expect(createAuthIpAddressConfig({ trustedProxyCidrs: ["192.0.2.10", "2001:db8::/64"], isProduction: true })).toEqual({
      ipAddressHeaders: ["x-forwarded-for"],
      trustedProxies: ["192.0.2.10", "2001:db8::/64"],
    });
  });

  it("parses only explicit proxy values and marks only a verified TOTP session", () => {
    expect(readAuthEnvironment({ ...authEnvironment, BETTER_AUTH_TRUSTED_PROXY_CIDRS: "192.0.2.10, 2001:db8::/64" })?.trustedProxyCidrs).toEqual(["192.0.2.10", "2001:db8::/64"]);
    expect(() => readAuthEnvironment({ ...authEnvironment, BETTER_AUTH_TRUSTED_PROXY_CIDRS: "192.0.2.10/99" })).toThrow("invalid IP or CIDR");
    expect(() => readAuthEnvironment({ ...authEnvironment, BETTER_AUTH_TRUSTED_PROXY_CIDRS: "999.999.999.999" })).toThrow("invalid IP or CIDR");
    expect(isTotpVerificationPath("/two-factor/verify-totp")).toBe(true);
    expect(isTotpVerificationPath("/two-factor/verify-backup-code")).toBe(false);
    expect(isTotpVerificationPath("/sign-in/username")).toBe(false);
  });
});
