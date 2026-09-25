import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { classifyRisk } from "../scripts/ci/classify-risk.mjs";
import { parseBoolean, parseTestFiles } from "../scripts/ci/run-scoped-proof.mjs";
import { scanText } from "../scripts/ci/scan-secrets.mjs";
import { verifyExactHead } from "../scripts/ci/verify-exact-head.mjs";
import { validateSourcecraftPolicy } from "../scripts/ci/verify-sourcecraft-policy.mjs";

describe("SourceCraft gate policy", () => {
  it("keeps gates manual-only and protects the default branch", () => {
    const ci = readFileSync(".sourcecraft/ci.yaml", "utf8");
    const branches = readFileSync(".sourcecraft/branches.yaml", "utf8");

    expect(ci).not.toMatch(/^on\s*:/mu);
    expect(ci).not.toMatch(/^\s*(push|pull_request|schedule)\s*:/mu);
    expect(ci.match(/^  merge-(standard|risky):$/gmu)).toHaveLength(2);
    expect(ci).toContain("node scripts/ci/verify-exact-head.mjs");
    expect(ci.match(/pnpm security:secrets/gmu)).toHaveLength(2);
    expect(ci).not.toMatch(/^\s*(deploy|publish)\s*:/mu);
    expect(branches).toContain("target: default_branch");
    expect(branches).toContain("prevent_force_push");
    expect(branches).toContain("prevent_non_pr_changes");
    expect(branches).toContain("prevent_deletion");
  });

  it("accepts current exact head and rejects stale or malformed SHA", () => {
    const current = "a".repeat(40);
    expect(verifyExactHead(current, current)).toBe(current);
    expect(() => verifyExactHead(current, "b".repeat(40))).toThrow(/mismatch/u);
    expect(() => verifyExactHead("main", current)).toThrow(/40-character/u);
  });

  it("rejects automatic triggers, broken SHA linkage and release actions", () => {
    const ci = readFileSync(".sourcecraft/ci.yaml", "utf8");
    const branches = readFileSync(".sourcecraft/branches.yaml", "utf8");

    expect(() => validateSourcecraftPolicy(`on:\n  push: []\n${ci}`, branches))
      .toThrow(/forbidden=2/u);
    expect(() => validateSourcecraftPolicy(
      ci.replaceAll("node scripts/ci/verify-exact-head.mjs", "echo unchecked"),
      branches,
    )).toThrow(/verify-exact-head/u);
    expect(() => validateSourcecraftPolicy(`${ci}\n  deploy:\n    tasks: []\n`, branches))
      .toThrow(/forbidden=1/u);
  });

  it("validates scoped test paths and explicit risk flags", () => {
    expect(parseTestFiles("tests/starter-contracts.test.ts", "UNIT_TEST_FILES"))
      .toEqual(["tests/starter-contracts.test.ts"]);
    expect(parseTestFiles("none", "INTEGRATION_TEST_FILES", { allowNone: true }))
      .toEqual([]);
    expect(() => parseTestFiles("tests/../secret.test.ts", "UNIT_TEST_FILES"))
      .toThrow(/invalid/u);
    expect(parseBoolean("true", "RUN_BUILD")).toBe(true);
    expect(() => parseBoolean("1", "RUN_BUILD")).toThrow(/true or false/u);
  });

  it("treats classifier output as a conservative attention hint", () => {
    expect(classifyRisk(["src/components/button.tsx"]).hint).toBe("STANDARD");
    expect(classifyRisk(["prisma/schema.prisma"]).hint).toBe("RISKY");
    expect(classifyRisk([]).hint).toBe("RISKY");
  });

  it("detects representative secrets without storing one in the fixture", () => {
    const fakeToken = ["pv1", "A".repeat(36)].join("_");
    expect(scanText(fakeToken)).toContain("SourceCraft token");
    expect(scanText("BETTER_AUTH_SECRET=ci-only-secret-not-for-production"))
      .toEqual([]);
  });
});
