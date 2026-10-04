import { describe, expect, it } from "vitest";
import { replaceProjectCatalogSubscriptionInputSchema } from "../src/modules/shared-catalog/contracts.ts";

const organizationId = "organization-test";
const projectId = "project-test";
const cityUid = "01M41T6Q04BADHXSERJHZFXKCH";
const developmentUid = "01M41T6Q07BADHXSERJHZFXKCJ";

describe("catalog subscription contract", () => {
  it("requires cities for ALL_SHARED and an include for CURATED", () => {
    expect(() => replaceProjectCatalogSubscriptionInputSchema.parse({ organizationId, projectId, mode: "ALL_SHARED", version: 0, cityUids: [], selections: [] })).toThrow();
    expect(() => replaceProjectCatalogSubscriptionInputSchema.parse({ organizationId, projectId, mode: "CURATED", version: 0, cityUids: [], selections: [{ developmentUid, decision: "EXCLUDE" }] })).toThrow();
    expect(() => replaceProjectCatalogSubscriptionInputSchema.parse({ organizationId, projectId, mode: "ALL_SHARED", version: 0, cityUids: [cityUid], selections: [{ developmentUid, decision: "INCLUDE" }] })).toThrow();
    expect(() => replaceProjectCatalogSubscriptionInputSchema.parse({ organizationId, projectId, mode: "CURATED", version: 0, cityUids: [cityUid], selections: [{ developmentUid, decision: "INCLUDE" }] })).toThrow();
    expect(replaceProjectCatalogSubscriptionInputSchema.parse({ organizationId, projectId, mode: "ALL_SHARED", version: 0, cityUids: [cityUid], selections: [] })).toMatchObject({ mode: "ALL_SHARED" });
    expect(replaceProjectCatalogSubscriptionInputSchema.parse({ organizationId, projectId, mode: "CURATED", version: 0, cityUids: [], selections: [{ developmentUid, decision: "INCLUDE" }] })).toMatchObject({ mode: "CURATED" });
  });

  it("rejects duplicate city and development decisions", () => {
    expect(() => replaceProjectCatalogSubscriptionInputSchema.parse({ organizationId, projectId, mode: "ALL_SHARED", version: 0, cityUids: [cityUid, cityUid], selections: [] })).toThrow();
    expect(() => replaceProjectCatalogSubscriptionInputSchema.parse({ organizationId, projectId, mode: "CURATED", version: 0, cityUids: [], selections: [{ developmentUid, decision: "INCLUDE" }, { developmentUid, decision: "EXCLUDE" }] })).toThrow();
  });
});
