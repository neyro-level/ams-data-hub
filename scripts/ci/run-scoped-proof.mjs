import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createTestDatabaseUrl, readTestDatabaseTarget } from "../verify-test-database-env.mjs";

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
    run("pnpm", ["build"], createRiskBuildEnvironment(process.env));
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
