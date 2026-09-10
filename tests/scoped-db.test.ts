import { describe, expect, it } from "vitest";
import {
  assertScopedOrganization,
  createScopedDb,
} from "../src/platform/database/scoped-db.ts";

const transaction = {} as never;

describe("scopedDb", () => {
  it("requires an explicit tenant and rejects cross-tenant identity", () => {
    expect(() => createScopedDb({ organizationId: "" }, transaction)).toThrow(
      "TENANT_SCOPE_REQUIRED",
    );
    const scopedDb = createScopedDb({ organizationId: "organization-a" }, transaction);
    expect(() => assertScopedOrganization(scopedDb, "organization-b")).toThrow(
      "CROSS_TENANT_ACCESS_DENIED",
    );
    expect(() => assertScopedOrganization(scopedDb, "organization-a")).not.toThrow();
  });
});
