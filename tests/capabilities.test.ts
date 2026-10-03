import { describe, expect, it } from "vitest";
import { hasCapability } from "../src/platform/authorization/capabilities.ts";

describe("capability matrix", () => {
  it("allows an organization editor to edit project content but not manage the organization", () => {
    expect(hasCapability("ORG_EDITOR", "project.editorial.write")).toBe(true);
    expect(hasCapability("ORG_EDITOR", "organization.manage")).toBe(false);
  });

  it("keeps an organization viewer read-only", () => {
    expect(hasCapability("ORG_VIEWER", "project.read")).toBe(true);
    expect(hasCapability("ORG_VIEWER", "source.run")).toBe(false);
  });
});
