import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const requiredCi = [
  "on:",
  "workflows: [merge-standard, merge-risky, release]",
  "paths: []",
  "merge-standard:",
  "merge-risky:",
  "release:",
  "expected_commit_sha:",
  "CHANGED_PATHS: ${{ inputs.changed_paths }}",
  "UNIT_TEST_FILES: ${{ inputs.unit_test_files }}",
  "INTEGRATION_TEST_FILES: ${{ inputs.integration_test_files }}",
  "node scripts/ci/verify-exact-head.mjs",
  "node scripts/ci/classify-risk.mjs",
  "pnpm security:secrets",
  "node scripts/ci/run-scoped-proof.mjs unit",
  "node scripts/ci/run-scoped-proof.mjs integration",
  "bash scripts/ci/sourcecraft-publish-images.sh",
];
const forbiddenCi = [
  /^\s*schedule\s*:/mu,
];
const requiredBranchRules = [
  "target: default_branch",
  "prevent_force_push",
  "prevent_non_pr_changes",
  "prevent_deletion",
];

export function validateSourcecraftPolicy(ci, branches) {
  const missingCi = requiredCi.filter((value) => !ci.includes(value));
  const forbiddenMatches = forbiddenCi.filter((pattern) => pattern.test(ci));
  const missingBranchRules = requiredBranchRules.filter((value) => !branches.includes(value));

  if (missingCi.length || forbiddenMatches.length || missingBranchRules.length) {
    throw new Error(
      `SourceCraft policy FAIL: missing CI=${missingCi.join(",") || "none"}; forbidden=${forbiddenMatches.length}; missing branch=${missingBranchRules.join(",") || "none"}`,
    );
  }
  const risky = ci.split("  merge-risky:")[1]?.split("  release:")[0] ?? "";
  const buildIndex = risky.indexOf("node scripts/ci/run-scoped-proof.mjs optional-risk");
  const integrationIndex = risky.indexOf("node scripts/ci/run-scoped-proof.mjs integration");
  if (buildIndex < 0 || integrationIndex < 0 || buildIndex >= integrationIndex) {
    throw new Error("SourceCraft policy FAIL: optional-risk build must precede integration web restart proof");
  }
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  validateSourcecraftPolicy(
    readFileSync(".sourcecraft/ci.yaml", "utf8"),
    readFileSync(".sourcecraft/branches.yaml", "utf8"),
  );
  console.log("SourceCraft policy: PASS (never-trigger sentinel, manual exact-head gates and exact-main release)");
}
