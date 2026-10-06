import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { validateRuntimeEnvironment } from "../scripts/runtime-environment.mjs";
import {
  RUNTIME_HEARTBEAT_WRITE_INTERVAL_MS,
} from "../src/modules/platform-operations/infrastructure/runtime-heartbeat.ts";
import {
  toWorkerStatus,
  WORKER_HEARTBEAT_STALE_MS,
} from "../src/modules/platform-operations/infrastructure/readiness-runtime.ts";

const releaseSha = "a".repeat(40);
const databaseEnvironment = {
  DATABASE_HOST: "database.internal",
  DATABASE_USER: "runtime",
  DATABASE_PASSWORD: "synthetic-password",
  DATABASE_NAME: "ams_data_hub",
};

describe("production runtime contract", () => {
  it("accepts only complete role-specific production environments", () => {
    const common: NodeJS.ProcessEnv = {
      APP_ENV: "production",
      NODE_ENV: "production",
      RELEASE_SHA: releaseSha,
      ...databaseEnvironment,
    };
    expect(
      validateRuntimeEnvironment("web", [], {
        ...common,
        BETTER_AUTH_SECRET: "s".repeat(32),
        BETTER_AUTH_URL: "https://data-hab.ams24.ru",
        BETTER_AUTH_TRUSTED_PROXY_CIDRS: "192.0.2.10",
      }),
    ).toMatchObject({ role: "web", mode: "runtime" });
    expect(
      validateRuntimeEnvironment("worker", ["outbox-worker"], {
        ...common,
        OUTBOX_WORKER_ID: "primary",
        PGBOSS_SCHEMA: "pgboss",
      }),
    ).toMatchObject({ role: "worker", mode: "runtime" });
    expect(() =>
      validateRuntimeEnvironment("worker", ["outbox-worker"], common),
    ).toThrow("OUTBOX_WORKER_ID");
    expect(() =>
      validateRuntimeEnvironment("web", [], { ...common, RELEASE_SHA: "latest" }),
    ).toThrow("RELEASE_SHA");
  });

  it("treats a worker heartbeat as healthy for at most two write intervals", () => {
    expect(WORKER_HEARTBEAT_STALE_MS).toBe(2 * RUNTIME_HEARTBEAT_WRITE_INTERVAL_MS);
    const now = new Date("2026-10-03T20:00:00.000Z");
    expect(
      toWorkerStatus(new Date(now.getTime() - WORKER_HEARTBEAT_STALE_MS), now),
    ).toBe("healthy");
    expect(
      toWorkerStatus(new Date(now.getTime() - WORKER_HEARTBEAT_STALE_MS - 1), now),
    ).toBe("stale");
    expect(toWorkerStatus(null, now)).toBe("unknown");
  });

  it("pins the image and logger and keeps every Compose env file mandatory", async () => {
    const [dockerfile, compose, packageJson, runtimeEntrypoint] = await Promise.all([
      readFile("Dockerfile", "utf8"),
      readFile("docker-compose.production.yml", "utf8"),
      readFile("package.json", "utf8").then(JSON.parse),
      readFile("scripts/runtime-entrypoint.mjs", "utf8"),
    ]);
    expect(dockerfile).not.toMatch(/apt-get\s+upgrade/u);
    expect(dockerfile).toMatch(/FROM node:[^\n]+@sha256:[0-9a-f]{64}/u);
    expect(packageJson.dependencies.pino).toBe("10.3.1");
    expect(runtimeEntrypoint).toContain('"--conditions=react-server"');
    expect(compose).not.toContain("required: false");
    expect(compose.match(/required: true/gu)).toHaveLength(10);
    expect(compose).toContain('"healthcheck"');
    expect(compose).not.toContain("process.kill(1, 0)");
    expect(compose).toContain("stop_grace_period: 60s");
    expect(compose).toContain('OUTBOX_SHUTDOWN_DRAIN_TIMEOUT_MS: "30000"');
    expect(compose).toMatch(/worker:[\s\S]*?tmpfs:[\s\S]*?size=640m/u);
    expect(compose).toMatch(/x-runtime-hardening:[\s\S]*?size=64m/u);
  });
});
