import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const POSTGRESQL_EVIDENCE_SCHEMA_VERSION = 1;

export const postgresqlEvidenceManifest = Object.freeze({
  foundationSuites: [
    "tests/integration/postgresql-foundation.integration.test.ts",
  ],
  contracts: {
    E02: {
      suites: ["tests/integration/account-setup.integration.test.ts"],
      scenarios: [
        "setup and recovery tokens are single-use and revoke stale sessions",
        "active setup, disabled-user and platform-admin MFA gates deny a fresh principal",
        "multi-membership requires an explicit organization",
      ],
    },
    E03: {
      suites: [
        "tests/integration/tenant-isolation.integration.test.ts",
        "tests/integration/principal-runtime-adoption.integration.test.ts",
      ],
      scenarios: [
        "missing tenant context and cross-tenant access are denied",
        "cross-tenant relations and organization-scope drift are rejected",
        "runtime web and worker roles cannot bypass RLS",
        "the declared tenant-model inventory has complete RLS coverage",
      ],
    },
    E04: {
      suites: ["tests/integration/command-atomicity.integration.test.ts"],
      scenarios: [
        "authorization is evaluated before persistence",
        "business, audit, idempotency and outbox state commit or roll back together",
      ],
    },
    E05: {
      suites: [
        "tests/integration/outbox-reliability.integration.test.ts",
        "tests/integration/worker-runtime-health.integration.test.ts",
        "tests/outbox-worker.test.ts",
      ],
      scenarios: [
        "lease fencing prevents competing or stale completion",
        "idempotency conflicts and bounded dead-letter delivery are deterministic",
        "shutdown finishes active work or records a recoverable classified failure",
        "worker health reads a fresh database heartbeat and a second permanent worker is denied",
      ],
    },
  },
});

const requiredContracts = ["E02", "E03", "E04", "E05"];
const forbiddenEvidenceKeys = /(database|dsn|host|password|payload|token|url|user(name)?)/i;

export function requiredPostgresqlEvidenceSuites(manifest = postgresqlEvidenceManifest) {
  return [
    ...manifest.foundationSuites,
    ...requiredContracts.flatMap((contract) => manifest.contracts[contract]?.suites ?? []),
  ].filter((suite, index, suites) => suites.indexOf(suite) === index);
}

export function validatePostgresqlEvidenceManifest(
  manifest = postgresqlEvidenceManifest,
  existingFiles = requiredPostgresqlEvidenceSuites(manifest),
) {
  for (const contract of requiredContracts) {
    const row = manifest.contracts[contract];
    if (!row || row.suites.length === 0 || row.scenarios.length === 0) {
      throw new Error(`POSTGRESQL_EVIDENCE_COVERAGE_MISSING:${contract}`);
    }
  }

  const existing = new Set(existingFiles);
  const missingSuites = requiredPostgresqlEvidenceSuites(manifest).filter(
    (suite) => !existing.has(suite),
  );
  if (missingSuites.length > 0) {
    throw new Error(`POSTGRESQL_EVIDENCE_SUITE_MISSING:${missingSuites.join(",")}`);
  }
}

function assertSecretFree(value, path = "evidence") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSecretFree(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenEvidenceKeys.test(key)) {
      throw new Error(`POSTGRESQL_EVIDENCE_FORBIDDEN_KEY:${path}.${key}`);
    }
    assertSecretFree(nested, `${path}.${key}`);
  }
}

export function createPostgresqlEvidenceSummary({ postgresMajor, migrationId, runs }) {
  if (postgresMajor !== 18) {
    throw new Error(`POSTGRESQL_EVIDENCE_VERSION_MISMATCH:${postgresMajor}`);
  }
  if (!migrationId?.trim()) {
    throw new Error("POSTGRESQL_EVIDENCE_MIGRATION_MISSING");
  }
  if (
    runs.length !== 2 ||
    runs[0]?.name !== "clean" ||
    runs[1]?.name !== "repeated-reverse" ||
    runs.some((run) => run.status !== "PASS")
  ) {
    throw new Error("POSTGRESQL_EVIDENCE_REPEATED_RUN_MISSING");
  }

  const requiredSuites = requiredPostgresqlEvidenceSuites();
  for (const run of runs) {
    const observed = new Set(run.suites);
    if (requiredSuites.some((suite) => !observed.has(suite))) {
      throw new Error(`POSTGRESQL_EVIDENCE_RUN_COVERAGE_MISSING:${run.name}`);
    }
  }

  const summary = {
    schemaVersion: POSTGRESQL_EVIDENCE_SCHEMA_VERSION,
    kind: "ams-postgresql-security-evidence",
    postgresMajor,
    migrationId,
    runs,
    contracts: Object.fromEntries(requiredContracts.map((contract) => [contract, "PASS"])),
    status: "PASS",
  };
  assertSecretFree(summary);
  return summary;
}

export async function clearPostgresqlEvidenceFile(filePath) {
  await rm(filePath, { force: true });
}

export async function writePostgresqlEvidenceFile(filePath, summary) {
  assertSecretFree(summary);
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  try {
    await writeFile(temporaryPath, `${JSON.stringify(summary, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}
