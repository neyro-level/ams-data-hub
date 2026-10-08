import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertRequiredRegressionProofs, readCandidateChangedPaths, requiredRegressionProofs, REQUIRED_RUNTIME_MATRIX } from "../scripts/ci/required-regression-proofs.mjs";

describe("actual-diff mandatory runtime proof selection", () => {
  it.each([
    "scripts/ci/required-regression-proofs.mjs", "scripts/ci/run-scoped-proof.mjs",
    "scripts/architecture-source-guards.mjs", ".sourcecraft/ci.yaml",
    "src/infrastructure/source-worker-runtime.ts", "src/worker/main.ts", "prisma/schema.prisma",
    "src/modules/platform-operations/worker.ts", "src/modules/platform-operations/infrastructure/operational-outbox-lease.ts",
    "src/modules/platform-operations/infrastructure/prisma-reliability-repository.ts",
    "src/modules/platform-operations/infrastructure/permanent-worker-guard.ts",
    "src/infrastructure/worker-process-lifecycle.ts", "src/infrastructure/worker-service-container.ts",
  ])("requires the full concrete runtime matrix for wiring/policy changes: %s", (file) => {
    expect(requiredRegressionProofs([file])).toEqual([...REQUIRED_RUNTIME_MATRIX].sort());
    expect(() => assertRequiredRegressionProofs([file], [])).toThrow(/MANDATORY_RUNTIME_PROOF_MISSING/u);
  });

  it.each([
    ["src/modules/ingestion-core/domain/yrl-2010-parser.ts", "source-worker"],
    ["src/modules/operations-control/worker.ts", "operational-rejection-executor"],
    ["src/app/api/snapshots/[organizationId]/[projectId]/ack/route.ts", "snapshot-consumer-http"],
    ["src/infrastructure/snapshot-build-capability.ts", "snapshot-source-worker"],
    ["src/infrastructure/ack-rotation-capability.ts", "operational-ack-rotation"],
  ])("rejects none or unrelated replacement for %s", (file, suite) => {
    expect(requiredRegressionProofs([file])).toContain(`tests/integration/${suite}.integration.test.ts`);
    expect(() => assertRequiredRegressionProofs([file], ["tests/integration/tenant-isolation.integration.test.ts"]))
      .toThrow(/MANDATORY_RUNTIME_PROOF_MISSING/u);
    expect(() => assertRequiredRegressionProofs([file], requiredRegressionProofs([file]))).not.toThrow();
  });

  it("keeps documentation-only scope minimal and preserves chosen extra coverage", () => {
    expect(assertRequiredRegressionProofs(["docs/04_BACKLOG.md"], [])).toEqual([]);
    expect(assertRequiredRegressionProofs(["docs/04_BACKLOG.md"], REQUIRED_RUNTIME_MATRIX)).toEqual([]);
  });

  it("retains required original suite paths for deletion/rename detection", () => {
    const file = "tests/integration/source-worker-shutdown.integration.test.ts";
    expect(requiredRegressionProofs([file, "tests/integration/renamed.integration.test.ts"])).toEqual([file]);
  });

  it("reads real commits rather than caller hints and fails closed without canonical base", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "adh-runtime-diff-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
    const commit = () => { git("add", "."); git("-c", "user.name=Runtime proof fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "synthetic fixture"); };
    try {
      git("init");
      writeFileSync(path.join(cwd, "README.md"), "synthetic baseline\n");
      commit();
      expect(() => readCandidateChangedPaths(cwd)).toThrow(/DIFF_UNAVAILABLE/u);
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      expect(readCandidateChangedPaths(cwd).paths).toEqual([]);
      mkdirSync(path.join(cwd, "src", "worker"), { recursive: true });
      writeFileSync(path.join(cwd, "src", "worker", "main.ts"), "synthetic runtime delta\n");
      commit();
      const candidate = readCandidateChangedPaths(cwd);
      expect(candidate.paths).toEqual(["src/worker/main.ts"]);
      expect(candidate.headSha).not.toBe(candidate.baseSha);
      expect(candidate.mergeBaseSha).toBe(candidate.baseSha);
      expect(() => assertRequiredRegressionProofs(candidate.paths, [])).toThrow(/MANDATORY_RUNTIME_PROOF_MISSING/u);
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      git("mv", "src/worker/main.ts", "src/worker/renamed.ts");
      commit();
      expect(readCandidateChangedPaths(cwd).paths).toEqual(["src/worker/main.ts", "src/worker/renamed.ts"]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
