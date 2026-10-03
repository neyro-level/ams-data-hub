import path from "node:path";
import { describe, expect, it } from "vitest";
import { verifyFinalConformance } from "../scripts/verify-final-conformance.mjs";

describe("final conformance contract", () => {
  it("maps the current product tree to exact Git evidence and bounded exceptions", () => {
    const result = verifyFinalConformance({ root: path.resolve("."), requireClean: false });

    expect(result.status).toBe("PASS");
    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(result.treeSha).toMatch(/^[0-9a-f]{40}$/);
    expect(result.identityMode).toBe("product");
    expect(["COMMERCIAL", "CRITICAL"]).toContain(result.deliveryProfile);
    expect(result.guaranteeGroups).toHaveLength(9);
    expect(result.boundedExceptions).toContain("exact-main-release-proof-required");
  });
});
