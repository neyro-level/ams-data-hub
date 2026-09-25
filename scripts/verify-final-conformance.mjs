import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const requiredFiles = [
  "docs/README.md",
  "docs/03_ARCHITECTURE.md",
  "docs/04_BACKLOG.md",
  "docs/05_RELEASE_CHECKLIST.md",
  "docs/DERIVATION.md",
  "docs/HANDOVER.md",
  "starter.identity.json",
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
  "derive:smoke",
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

  requireText(root, "docs/README.md", ["`HANDOVER.md`"]);
  requireText(root, "docs/HANDOVER.md", [
    "## Guarantee-to-proof matrix",
    "## Verify command matrix",
    "## Known bounded exceptions",
    "## Derived-product handover",
    "## Final-main closure",
    "No step in this handover authorizes production.",
  ]);
  requireText(root, "docs/05_RELEASE_CHECKLIST.md", ["manual exact-head SourceCraft merge gate", "Build one immutable artifact set"]);
  requireText(root, "docs/DERIVATION.md", ["outboxPlusQueue", "pnpm derive:smoke"]);
  requireText(root, ".sourcecraft/ci.yaml", ["merge-standard:", "merge-risky:", "EXPECTED_COMMIT_SHA"]);
  requireText(root, ".sourcecraft/branches.yaml", ["prevent_force_push", "prevent_non_pr_changes", "prevent_deletion"]);

  const identity = JSON.parse(read(root, "starter.identity.json"));
  if (!new Set(["starter", "derived"]).has(identity.mode)) throw new Error("Unknown identity mode.");
  const architecture = read(root, "docs/03_ARCHITECTURE.md");
  const deliveryProfile = identity.mode === "starter" ? "EXPERIMENT" : identity.derivation?.deliveryProfile;
  if (identity.mode === "starter" && !architecture.includes("DELIVERY_PROFILE = EXPERIMENT")) {
    throw new Error("Starter architecture must retain DELIVERY_PROFILE = EXPERIMENT.");
  }
  if (identity.mode === "starter") {
    requireText(root, "docs/HANDOVER.md", ["CI NOT RUN (EXPERIMENT)"]);
    requireText(root, "docs/05_RELEASE_CHECKLIST.md", ["this starter itself is not a release target"]);
  }
  if (identity.mode === "derived" && !new Set(["COMMERCIAL", "CRITICAL"]).has(deliveryProfile)) {
    throw new Error("Derived product must select COMMERCIAL or CRITICAL before final conformance.");
  }
  if (identity.mode === "derived" && identity.derivation?.migrationOwner !== identity.identity?.productSlug) {
    throw new Error("Derived product migration ownership must match identity.productSlug.");
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
    identityMode: identity.mode,
    deliveryProfile,
    guaranteeGroups: ["identity", "postgresql", "authorization", "commands", "async", "ci", "runtime", "ui", "derivation", "handover"],
    boundedExceptions: ["starter-not-production", "experiment-no-paid-ci", "derived-product-release-proof-required"],
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
