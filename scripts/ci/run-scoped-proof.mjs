import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createTestDatabaseUrl, readTestDatabaseTarget } from "../verify-test-database-env.mjs";
import { assertRequiredRegressionProofs, readCandidateChangedPaths } from "./required-regression-proofs.mjs";
import { verifyExactHead } from "./verify-exact-head.mjs";

const rootDir = path.resolve(import.meta.dirname, "../..");
const testPathPattern = /^tests\/[A-Za-z0-9._/-]+\.test\.ts$/;

export function parseTestFiles(rawValue, inputName, { allowNone = false } = {}) {
  if (allowNone && rawValue?.trim().toLowerCase() === "none") return [];

  const files = (rawValue ?? "")
    .split(/[\n,]/u)
    .map((value) => value.trim().replaceAll("\\", "/"))
    .filter(Boolean);

  if (files.length === 0) {
    throw new Error(`${inputName} must name at least one test file`);
  }
  for (const file of files) {
    if (!testPathPattern.test(file) || file.split("/").includes("..")) {
      throw new Error(`${inputName} contains an invalid test path: ${file}`);
    }
    if (!existsSync(path.join(rootDir, file))) {
      throw new Error(`${inputName} references a missing test file: ${file}`);
    }
  }
  return [...new Set(files)];
}

export function parseBoolean(rawValue, inputName) {
  if (rawValue === "true") return true;
  if (rawValue === "false") return false;
  throw new Error(`${inputName} must be true or false`);
}

function run(command, args, environment = process.env) {
  const windowsPnpm = process.platform === "win32" && command === "pnpm";
  const executable = windowsPnpm ? (process.env.ComSpec ?? "cmd.exe") : command;
  const commandArgs = windowsPnpm ? ["/d", "/s", "/c", ["pnpm", ...args].join(" ")] : args;
  const result = spawnSync(executable, commandArgs, {
    cwd: rootDir,
    env: environment,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

export function createRiskBuildEnvironment(environment) {
  const target = readTestDatabaseTarget(environment);
  return {
    ...environment,
    DATABASE_HOST: target.host,
    DATABASE_PORT: String(target.port),
    DATABASE_USER: target.user,
    DATABASE_PASSWORD: target.password,
    DATABASE_NAME: target.database,
    DATABASE_SSLMODE: target.sslmode,
    DATABASE_URL: createTestDatabaseUrl(target),
  };
}

export function mandatoryUnitProofFiles(selectedFiles) {
  return [...new Set([
    ...selectedFiles,
    "tests/architecture-source-guards.test.ts",
    "tests/architecture-runtime-guards.test.ts",
    "tests/sourcecraft-policy.test.ts",
    "tests/required-regression-proofs.test.ts",
  ])];
}

function runUnitProof() {
  const files = mandatoryUnitProofFiles(parseTestFiles(process.env.UNIT_TEST_FILES, "UNIT_TEST_FILES"));
  run(process.execPath, ["node_modules/vitest/vitest.mjs", "run", ...files]);
}

export function assertIntegrationPrerequisites(files, runBuild, standaloneReady = existsSync(path.join(rootDir, ".next/standalone/server.js"))) {
  if (files.includes("tests/integration/source-worker-shutdown.integration.test.ts")
    && (runBuild !== "true" || !standaloneReady)) {
    throw new Error("SCOPED_WEB_RESTART_REQUIRES_CURRENT_BUILD: run optional-risk with RUN_BUILD=true before integration");
  }
}

function runIntegrationProof() {
  const files = parseTestFiles(
    process.env.INTEGRATION_TEST_FILES,
    "INTEGRATION_TEST_FILES",
    { allowNone: true },
  );
  if (files.length === 0) {
    console.log("Scoped integration proof: skipped (reviewed scope has no DB risk)");
    return;
  }
  assertIntegrationPrerequisites(files, process.env.RUN_BUILD);
  run(process.execPath, ["scripts/run-integration-tests.mjs", ...files]);
}

function runOptionalRiskProof() {
  if (parseBoolean(process.env.RUN_DEPENDENCY_SCAN, "RUN_DEPENDENCY_SCAN")) {
    run("pnpm", ["security:dependencies"]);
  }
  if (parseBoolean(process.env.RUN_BUILD, "RUN_BUILD")) {
    run("pnpm", ["build"], createRiskBuildEnvironment(process.env));
  }
}

function assertCandidateRegressionScope() {
  const candidate = readCandidateChangedPaths(rootDir);
  verifyExactHead(process.env.EXPECTED_COMMIT_SHA, candidate.headSha);
  const files = parseTestFiles(process.env.INTEGRATION_TEST_FILES ?? "none", "INTEGRATION_TEST_FILES", { allowNone: true });
  const required = assertRequiredRegressionProofs(candidate.paths, files);
  if (required.includes("tests/integration/source-worker-shutdown.integration.test.ts") && process.env.RUN_BUILD !== "true") {
    throw new Error("MANDATORY_RUNTIME_CURRENT_BUILD_REQUIRED: RUN_BUILD=true for native web restart");
  }
  console.log(`Mandatory runtime scope: head=${candidate.headSha} base=${candidate.baseSha} merge_base=${candidate.mergeBaseSha} suites=${required.length}`);
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const mode = process.argv[2];
  if (["unit", "integration", "optional-risk"].includes(mode)) assertCandidateRegressionScope();
  if (mode === "unit") runUnitProof();
  else if (mode === "integration") runIntegrationProof();
  else if (mode === "optional-risk") runOptionalRiskProof();
  else throw new Error("Usage: run-scoped-proof.mjs <unit|integration|optional-risk>");
}
