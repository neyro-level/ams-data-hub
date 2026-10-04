import { createUlid } from "@ams-data-hub/data-contracts";
import { describe, expect, it } from "vitest";
import {
  createProjectUrlEntryInputSchema,
  replaceProjectUrlPolicyInputSchema,
  transitionProjectUrlLifecycleInputSchema,
} from "../src/modules/project-state/index.ts";

const base = { organizationId: "organization-1", projectId: "project-1" };

describe("project URL registry contract", () => {
  it("accepts site-owned templates without interpreting their grammar", () => {
    const input = {
      ...base,
      version: 0,
      policyKey: "site-url-policy-v1",
      pathTemplates: [{ entityType: "INVENTORY" as const, template: "/custom/{slug}-{publicUrlId}" }],
      reservedNamespaces: ["api", "admin"],
    };
    expect(replaceProjectUrlPolicyInputSchema.parse(input)).toEqual(input);
    expect(() => replaceProjectUrlPolicyInputSchema.parse({ ...input, pathTemplates: [...input.pathTemplates, ...input.pathTemplates] })).toThrow();
  });

  it("accepts only local canonical paths and requires redirect targets consistently", () => {
    const entry = { ...base, entityType: "INVENTORY" as const, entityUid: createUlid(), slug: "flat-42", canonicalPath: "/offers/flat-42" };
    expect(createProjectUrlEntryInputSchema.parse(entry)).toEqual(entry);
    expect(() => createProjectUrlEntryInputSchema.parse({ ...entry, canonicalPath: "https://example.test/offers/flat-42" })).toThrow();
    expect(() => createProjectUrlEntryInputSchema.parse({ ...entry, canonicalPath: "/offers//flat-42" })).toThrow();
    expect(() => transitionProjectUrlLifecycleInputSchema.parse({ ...base, urlEntryId: "entry-1", version: 1, factualLifecycle: "ACTIVE", presentationLifecycle: "REDIRECTED", redirectTargetPath: null, reason: "LIFECYCLE" })).toThrow();
  });
});
