import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  clearPostgresqlEvidenceFile,
  createPostgresqlEvidenceSummary,
  postgresqlEvidenceManifest,
  requiredPostgresqlEvidenceSuites,
  validatePostgresqlEvidenceManifest,
  writePostgresqlEvidenceFile,
} from "../scripts/postgresql-evidence.mjs";

describe("PostgreSQL cross-contract evidence", () => {
  it("includes every native integration suite in the explicit final-candidate matrix", async () => {
    const diskSuites = (await readdir(path.resolve("tests/integration")))
      .filter((file) => file.endsWith(".integration.test.ts"))
      .map((file) => `tests/integration/${file}`).sort();
    expect(requiredPostgresqlEvidenceSuites().filter((file) => file.endsWith(".integration.test.ts")).sort())
      .toEqual(diskSuites);
    expect(() => validatePostgresqlEvidenceManifest({ ...postgresqlEvidenceManifest,
      contracts: { ...postgresqlEvidenceManifest.contracts, MP10: undefined } } as never))
      .toThrow("POSTGRESQL_EVIDENCE_COVERAGE_MISSING:MP10");
  });
  it("fails closed when an E02-E05 matrix row or suite is absent", () => {
    const missingContract = {
      ...postgresqlEvidenceManifest,
      contracts: { ...postgresqlEvidenceManifest.contracts, E04: undefined },
    };
    expect(() => validatePostgresqlEvidenceManifest(missingContract as never)).toThrow(
      "POSTGRESQL_EVIDENCE_COVERAGE_MISSING:E04",
    );

    expect(() =>
      validatePostgresqlEvidenceManifest(
        postgresqlEvidenceManifest,
        requiredPostgresqlEvidenceSuites().slice(1),
      ),
    ).toThrow("POSTGRESQL_EVIDENCE_SUITE_MISSING");
  });

  it("creates only a complete repeated-run, secret-free PASS summary", () => {
    const suites = requiredPostgresqlEvidenceSuites();
    const summary = createPostgresqlEvidenceSummary({
      postgresMajor: 18,
      migrationId: "20260925153000_global_job_run_outbox_integrity",
      runs: [
        { name: "clean", status: "PASS", suites },
        { name: "repeated-reverse", status: "PASS", suites: [...suites].reverse() },
      ],
    });

    expect(summary).toMatchObject({
      schemaVersion: 1,
      postgresMajor: 18,
      contracts: { E02: "PASS", E03: "PASS", E04: "PASS", E05: "PASS", MP10: "PASS" },
      status: "PASS",
    });
    expect(JSON.stringify(summary)).not.toMatch(/password|databaseUrl|token|payload/i);
    expect(() => createPostgresqlEvidenceSummary({
      postgresMajor: 17,
      migrationId: "migration",
      runs: [],
    })).toThrow("POSTGRESQL_EVIDENCE_VERSION_MISMATCH:17");
  });

  it("removes stale PASS evidence and publishes the replacement atomically", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ams-postgresql-evidence-"));
    const evidencePath = path.join(directory, "nested", "evidence.json");
    const suites = requiredPostgresqlEvidenceSuites();
    const summary = createPostgresqlEvidenceSummary({
      postgresMajor: 18,
      migrationId: "20260925153000_global_job_run_outbox_integrity",
      runs: [
        { name: "clean", status: "PASS", suites },
        { name: "repeated-reverse", status: "PASS", suites: [...suites].reverse() },
      ],
    });

    try {
      await writePostgresqlEvidenceFile(evidencePath, summary);
      await clearPostgresqlEvidenceFile(evidencePath);
      await expect(stat(evidencePath)).rejects.toMatchObject({ code: "ENOENT" });

      await writePostgresqlEvidenceFile(evidencePath, summary);
      expect(JSON.parse(await readFile(evidencePath, "utf8"))).toEqual(summary);
      if (process.platform !== "win32") {
        expect((await stat(evidencePath)).mode & 0o777).toBe(0o600);
      }
      expect(await readdir(path.dirname(evidencePath))).toEqual(["evidence.json"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
