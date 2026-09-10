import { describe, expect, it } from "vitest";
import { PrismaIdentityAdminRepository } from "../src/modules/identity-access/server.ts";
import { PrismaProjectRegistryAdminRepository } from "../src/modules/project-registry/server.ts";

describe("Platform Admin runtime boundary", () => {
  it("constructs the identity and registry server adapters without build-time database configuration", () => {
    expect(() => new PrismaIdentityAdminRepository()).not.toThrow();
    expect(() => new PrismaProjectRegistryAdminRepository()).not.toThrow();
  });
});
