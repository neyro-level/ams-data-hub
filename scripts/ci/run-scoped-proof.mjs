import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runUnitProof() {
  const files = parseTestFiles(process.env.UNIT_TEST_FILES, "UNIT_TEST_FILES");
  run(process.execPath, ["node_modules/vitest/vitest.mjs", "run", ...files]);
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
  run(process.execPath, ["scripts/run-integration-tests.mjs", ...files]);
}

function runOptionalRiskProof() {
  if (parseBoolean(process.env.RUN_DEPENDENCY_SCAN, "RUN_DEPENDENCY_SCAN")) {
    run("pnpm", ["security:dependencies"]);
  }
  if (parseBoolean(process.env.RUN_BUILD, "RUN_BUILD")) {
    run("pnpm", ["build"]);
  }
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const mode = process.argv[2];
  if (mode === "unit") runUnitProof();
  else if (mode === "integration") runIntegrationProof();
  else if (mode === "optional-risk") runOptionalRiskProof();
  else throw new Error("Usage: run-scoped-proof.mjs <unit|integration|optional-risk>");
}
