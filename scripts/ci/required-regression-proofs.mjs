import { execFileSync } from "node:child_process";

const integration = (name) => `tests/integration/${name}.integration.test.ts`;
export const REQUIRED_RUNTIME_MATRIX = Object.freeze([
  "source-worker", "snapshot-source-worker", "operational-approval-executor",
  "operational-rejection-executor", "operational-ack-rotation", "snapshot-consumer-http",
  "source-worker-shutdown", "remediation-vladis-pipeline", "remediation-marketplace-pipeline",
  "remediation-newbuilding-pipeline",
].map(integration));

/** Coverage selection uses real candidate paths, never CHANGED_PATHS input. */
export function requiredRegressionProofs(changedPaths) {
  const required = new Set();
  const add = (...names) => names.forEach((name) => required.add(integration(name)));
  for (const supplied of changedPaths) {
    const file = supplied.replaceAll("\\", "/");
    if (/^(?:\.sourcecraft\/|prisma\/|src\/worker\/|scripts\/ci\/|scripts\/(?:verify-architecture|architecture-(?:source|runtime)-guards)|tests\/(?:architecture-(?:source|runtime)-guards|required-regression-proofs|sourcecraft-policy)\.test\.ts$)/u.test(file)
      || file === "src/infrastructure/source-worker-runtime.ts"
      || file === "tests/snapshot-public-policy.test.ts"
      || /^src\/modules\/platform-operations\//u.test(file)
      || /^src\/infrastructure\/worker-/u.test(file)
      || /^(?:package\.json|pnpm-lock\.yaml|vitest\.integration\.config\.mts|scripts\/run-integration-tests\.mjs)$/u.test(file)) {
      REQUIRED_RUNTIME_MATRIX.forEach((suite) => required.add(suite));
    }
    if (file.startsWith("src/modules/ingestion-core/") || /^src\/infrastructure\/source-/u.test(file)) {
      add("source-worker", "snapshot-source-worker", "remediation-vladis-pipeline", "remediation-marketplace-pipeline");
    }
    if (/^src\/modules\/operations-control\//u.test(file)) {
      add("operational-approval-executor", "operational-rejection-executor", "operational-ack-rotation", "snapshot-source-worker");
    }
    if (/^src\/(?:modules\/snapshot-delivery\/|infrastructure\/snapshot-|app\/api\/snapshots\/)/u.test(file)
      || /^packages\/(?:snapshot-verifier|data-contracts|realty-contracts)\//u.test(file)) {
      add("snapshot-source-worker", "snapshot-consumer-http", "source-worker-shutdown");
    }
    if (/^src\/(?:modules\/(?:project-state|shared-catalog|media-assets)\/|infrastructure\/newbuilding-)/u.test(file)) {
      add("remediation-vladis-pipeline", "remediation-marketplace-pipeline", "remediation-newbuilding-pipeline", "snapshot-consumer-http");
    }
    if (/^src\/(?:platform\/(?:authorization|database|http|storage|security)\/|modules\/identity-access\/)/u.test(file)) {
      REQUIRED_RUNTIME_MATRIX.forEach((suite) => required.add(suite));
    }
    if (file === "src/infrastructure/ack-rotation-capability.ts") add("operational-ack-rotation", "snapshot-consumer-http");
    if (file.startsWith("tests/helpers/")) REQUIRED_RUNTIME_MATRIX.forEach((suite) => required.add(suite));
    // Editing, deleting or renaming the actual required suite cannot hide it.
    if (REQUIRED_RUNTIME_MATRIX.includes(file)) required.add(file);
  }
  return [...required].sort();
}

export function assertRequiredRegressionProofs(changedPaths, selectedFiles) {
  const required = requiredRegressionProofs(changedPaths);
  const selected = new Set(selectedFiles);
  const missing = required.filter((file) => !selected.has(file));
  if (missing.length) throw new Error(`MANDATORY_RUNTIME_PROOF_MISSING: ${missing.join(",")}`);
  return required;
}

/** Full-depth canonical checkout is required; missing base fails closed. */
export function readCandidateChangedPaths(cwd) {
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    const headSha = git("rev-parse", "--verify", "HEAD^{commit}").trim();
    const baseSha = git("rev-parse", "--verify", "refs/remotes/origin/main^{commit}").trim();
    const mergeBaseSha = git("merge-base", baseSha, headSha).trim();
    const paths = git("diff", "--name-only", "--no-renames", "-z", mergeBaseSha, headSha, "--")
      .split("\0").filter(Boolean);
    return { headSha, baseSha, mergeBaseSha, paths };
  } catch {
    throw new Error("MANDATORY_RUNTIME_DIFF_UNAVAILABLE: full-depth canonical origin/main and candidate HEAD are required");
  }
}
