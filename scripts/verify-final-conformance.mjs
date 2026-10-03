import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const requiredFiles = [
  "docs/README.md",
  "docs/03_ARCHITECTURE.md",
  "docs/04_BACKLOG.md",
  "docs/05_RELEASE_CHECKLIST.md",
  "docs/SECURITY.md",
  "docs/OPERATIONS.md",
  "docs/AMS Data Hub Master Plan v1.md",
  "docs/AMS_DATA_HUB_MASTER_PLAN_V1.inventory.json",
  "project.identity.json",
  ".sourcecraft/branches.yaml",
  ".sourcecraft/ci.yaml",
  "Dockerfile",
  "docker-compose.production.yml",
  "ops/release/rollback.sh",
];

const requiredScripts = [
  "verify:quick",
  "test:unit",
  "test:integration",
  "test:e2e:run",
  "security:semgrep",
  "security:dependencies",
  "security:secrets",
  "verify:sourcecraft-policy",
  "verify:release-template",
  "verify:conformance",
  "verify:release",
];

function read(root, file) {
  return readFileSync(path.join(root, file), "utf8");
}

function requireText(root, file, values) {
  const content = read(root, file);
  for (const value of values) {
    if (!content.includes(value)) throw new Error(`Final conformance missing ${JSON.stringify(value)} in ${file}.`);
  }
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function verifyFinalConformance({ root = process.cwd(), requireClean = true } = {}) {
  for (const file of requiredFiles) {
    if (!existsSync(path.join(root, file))) throw new Error(`Final conformance file is missing: ${file}.`);
  }

  const packageJson = JSON.parse(read(root, "package.json"));
  for (const script of requiredScripts) {
    if (typeof packageJson.scripts?.[script] !== "string" || !packageJson.scripts[script].trim()) {
      throw new Error(`Final conformance script is missing: ${script}.`);
    }
  }
  if (!packageJson.scripts["verify:release"].includes("verify:conformance")) {
    throw new Error("verify:release must include verify:conformance.");
  }
  if (packageJson.scripts["test:e2e:run"] !== "node scripts/run-e2e-tests.mjs") {
    throw new Error("test:e2e:run must use the guarded local database lifecycle.");
  }

  requireText(root, "docs/README.md", ["`05_RELEASE_CHECKLIST.md`", "`OPERATIONS.md`"]);
  requireText(root, "docs/05_RELEASE_CHECKLIST.md", [
    "## Guarantee-to-proof matrix",
    "## Known bounded exceptions",
    "## Handover and rollback",
    "Production always requires a separate",
  ]);
  requireText(root, "docs/OPERATIONS.md", ["## Production deployment", "## Recovery and restore"]);
  requireText(root, "docs/AMS Data Hub Master Plan v1.md", ["Plan ID: AMS-DATA-HUB-IMPLEMENTATION-2026-01", "Status: APPROVED"]);
  requireText(root, ".sourcecraft/ci.yaml", ["merge-standard:", "merge-risky:", "EXPECTED_COMMIT_SHA"]);
  requireText(root, ".sourcecraft/branches.yaml", ["prevent_force_push", "prevent_non_pr_changes", "prevent_deletion"]);

  const identity = JSON.parse(read(root, "project.identity.json"));
  const architecture = read(root, "docs/03_ARCHITECTURE.md");
  const deliveryProfile = identity.deliveryProfile;
  if (!new Set(["COMMERCIAL", "CRITICAL"]).has(deliveryProfile)) {
    throw new Error("Data Hub must retain COMMERCIAL or CRITICAL delivery profile before final conformance.");
  }
  if (!architecture.includes(`DELIVERY_PROFILE = ${deliveryProfile}`)) {
    throw new Error("Project identity and Architecture delivery profiles differ.");
  }

  const migrations = git(root, ["ls-files", "prisma/migrations"]).split(/\r?\n/u).filter(Boolean);
  if (migrations.length === 0) throw new Error("Final conformance requires a tracked migration baseline.");
  const commitSha = git(root, ["rev-parse", "HEAD"]);
  const treeSha = git(root, ["rev-parse", "HEAD^{tree}"]);
  if (!/^[0-9a-f]{40}$/u.test(commitSha) || !/^[0-9a-f]{40}$/u.test(treeSha)) {
    throw new Error("Final conformance could not resolve exact Git identity.");
  }
  if (requireClean && git(root, ["status", "--porcelain", "--untracked-files=no"])) {
    throw new Error("Final conformance requires a clean tracked worktree.");
  }

  return {
    schemaVersion: 1,
    status: "PASS",
    commitSha,
    treeSha,
    identityMode: "product",
    deliveryProfile,
    guaranteeGroups: ["identity", "postgresql", "authorization", "commands", "async", "ci", "runtime", "ui", "handover"],
    boundedExceptions: ["first-release-no-previous-application-image", "exact-main-release-proof-required"],
  };
}

function main() {
  const root = process.cwd();
  const evidence = verifyFinalConformance({ root, requireClean: true });
  const evidenceDirectory = path.join(root, ".local", "evidence");
  mkdirSync(evidenceDirectory, { recursive: true });
  writeFileSync(path.join(evidenceDirectory, "final-conformance.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`final_conformance=PASS sha=${evidence.commitSha} tree=${evidence.treeSha} mode=${evidence.identityMode} profile=${evidence.deliveryProfile}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
