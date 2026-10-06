import { describe, expect, it } from "vitest";
import { readAuthEnvironment } from "../src/platform/config/server-environment.ts";
import {
  createAuthIpAddressConfig,
} from "../src/platform/auth/security-config.ts";

const authEnvironment = {
  BETTER_AUTH_SECRET: "a-secure-test-secret-that-is-longer-than-32-characters",
  BETTER_AUTH_URL: "https://data-hub.example.test",
};

describe("auth network and current-release configuration", () => {
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

  it("parses only explicit valid proxy values", () => {
    expect(readAuthEnvironment({ ...authEnvironment, BETTER_AUTH_TRUSTED_PROXY_CIDRS: "192.0.2.10, 2001:db8::/64" })?.trustedProxyCidrs).toEqual(["192.0.2.10", "2001:db8::/64"]);
    expect(() => readAuthEnvironment({ ...authEnvironment, BETTER_AUTH_TRUSTED_PROXY_CIDRS: "192.0.2.10/99" })).toThrow("invalid IP or CIDR");
    expect(() => readAuthEnvironment({ ...authEnvironment, BETTER_AUTH_TRUSTED_PROXY_CIDRS: "999.999.999.999" })).toThrow("invalid IP or CIDR");
  });

  it("supports the approved production policy without a factor variable and keeps client access opt-in", () => {
    expect(readAuthEnvironment({
      ...authEnvironment,
      APP_ENV: "production",
      CLIENT_ACCESS_ENABLED: "true",
    })).toMatchObject({ clientAccessEnabled: true });
    expect(readAuthEnvironment(authEnvironment)).toMatchObject({
      clientAccessEnabled: false,
    });
    expect(() => readAuthEnvironment({ ...authEnvironment, CLIENT_ACCESS_ENABLED: "yes" })).toThrow("must be true or false");
    expect(() => readAuthEnvironment({ ...authEnvironment, BETTER_AUTH_URL: "http://data-hub.example.test" })).toThrow("must use HTTPS");
  });
});
