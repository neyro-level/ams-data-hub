import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { classifyRisk } from "../scripts/ci/classify-risk.mjs";
import { assertIntegrationPrerequisites, createRiskBuildEnvironment, parseBoolean, parseTestFiles } from "../scripts/ci/run-scoped-proof.mjs";
import { scanText } from "../scripts/ci/scan-secrets.mjs";
import { verifyExactHead } from "../scripts/ci/verify-exact-head.mjs";
import { validateSourcecraftPolicy } from "../scripts/ci/verify-sourcecraft-policy.mjs";

describe("SourceCraft gate policy", () => {
  it("keeps gates manual-only and protects the default branch", () => {
    const ci = readFileSync(".sourcecraft/ci.yaml", "utf8");
    const branches = readFileSync(".sourcecraft/branches.yaml", "utf8");

    expect(ci).toMatch(/^on\s*:/mu);
    expect(ci.match(/paths: \[\]/gmu)).toHaveLength(2);
    expect(ci).toContain("workflows: [merge-standard, merge-risky, release]");
    expect(ci).not.toMatch(/^\s*schedule\s*:/mu);
    expect(ci.match(/^  merge-(standard|risky):$/gmu)).toHaveLength(2);
    expect(ci).toContain("node scripts/ci/verify-exact-head.mjs");
    expect(ci).toContain("LOCAL_POSTGRES_USER: ams_data_hub_local");
    expect(ci).toContain("DATABASE_NAME: ams_data_hub_dev");
    expect(ci.match(/pnpm security:secrets/gmu)).toHaveLength(2);
    expect(ci).toContain("bash scripts/ci/sourcecraft-publish-images.sh");
    expect(ci).toContain("VERIFIED_GATE_RUN_SLUG");
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

    expect(() => validateSourcecraftPolicy(ci.replaceAll("paths: []", "paths: [\"**\"]"), branches))
      .toThrow(/paths/u);
    expect(() => validateSourcecraftPolicy(
      ci.replaceAll("node scripts/ci/verify-exact-head.mjs", "echo unchecked"),
      branches,
    )).toThrow(/verify-exact-head/u);
    expect(() => validateSourcecraftPolicy(`${ci}\n  schedule:\n    interval: 1h\n`, branches))
      .toThrow(/forbidden=1/u);
  });

  it("validates scoped test paths and explicit risk flags", () => {
    expect(parseTestFiles("tests/data-hub-contracts.test.ts", "UNIT_TEST_FILES"))
      .toEqual(["tests/data-hub-contracts.test.ts"]);
    expect(parseTestFiles("none", "INTEGRATION_TEST_FILES", { allowNone: true }))
      .toEqual([]);
    expect(() => parseTestFiles("tests/../secret.test.ts", "UNIT_TEST_FILES"))
      .toThrow(/invalid/u);
    expect(parseBoolean("true", "RUN_BUILD")).toBe(true);
    expect(() => parseBoolean("1", "RUN_BUILD")).toThrow(/true or false/u);
  });

  it("builds under the same guarded test database identity used by CI", () => {
    const environment = createRiskBuildEnvironment({
      APP_ENV: "test",
      LOCAL_POSTGRES_USER: "ams_data_hub_local",
      DATABASE_USER: "ams_data_hub_local",
      DATABASE_NAME: "ams_data_hub_dev",
      TEST_DATABASE_HOST: "127.0.0.1",
      TEST_DATABASE_PORT: "5432",
      TEST_DATABASE_USER: "ams_data_hub_test",
      TEST_DATABASE_PASSWORD: "ci-only-password",
      TEST_DATABASE_NAME: "ams_data_hub_ci_test",
      TEST_DATABASE_SSLMODE: "disable",
    });

    expect(environment.DATABASE_USER).toBe("ams_data_hub_test");
    expect(environment.DATABASE_NAME).toBe("ams_data_hub_ci_test");
    expect(environment.DATABASE_URL).toContain("/ams_data_hub_ci_test");
  });

  it("requires the current standalone before native web restart and rejects reversed gate order", () => {
    const files = ["tests/integration/source-worker-shutdown.integration.test.ts"];
    expect(() => assertIntegrationPrerequisites(files, "true", true)).not.toThrow();
    expect(() => assertIntegrationPrerequisites(files, "false", true)).toThrow(/REQUIRES_CURRENT_BUILD/u);
    expect(() => assertIntegrationPrerequisites(files, "true", false)).toThrow(/REQUIRES_CURRENT_BUILD/u);
    expect(() => assertIntegrationPrerequisites(["tests/integration/source-registry.integration.test.ts"], "false", false)).not.toThrow();
    const ci = readFileSync(".sourcecraft/ci.yaml", "utf8");
    const reversed = ci.replace("node scripts/ci/run-scoped-proof.mjs optional-risk", "SWAP_BUILD")
      .replace("node scripts/ci/run-scoped-proof.mjs integration", "node scripts/ci/run-scoped-proof.mjs optional-risk")
      .replace("SWAP_BUILD", "node scripts/ci/run-scoped-proof.mjs integration");
    expect(() => validateSourcecraftPolicy(reversed, readFileSync(".sourcecraft/branches.yaml", "utf8"))).toThrow(/must precede/u);
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
