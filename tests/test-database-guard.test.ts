import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readTestDatabaseTarget } from "../scripts/verify-test-database-env.mjs";
import { createPsqlInvocation } from "../scripts/prepare-rls-test-identities.mjs";

const guard = path.resolve("scripts/verify-test-database-env.mjs");

function runGuard(environment: Record<string, string>) {
  return spawnSync(process.execPath, [guard], {
    env: { ...process.env, ...environment },
    encoding: "utf8",
  });
}

const safeEnvironment = {
  APP_ENV: "test",
  NODE_ENV: "test" as const,
  LOCAL_POSTGRES_USER: "ams_data_hub_local",
  DATABASE_USER: "ams_data_hub_local",
  DATABASE_NAME: "ams_data_hub_dev",
  TEST_DATABASE_HOST: "127.0.0.1",
  TEST_DATABASE_PORT: "5435",
  TEST_DATABASE_USER: "ams_data_hub_test",
  TEST_DATABASE_PASSWORD: "not-a-real-secret",
  TEST_DATABASE_NAME: "ams_data_hub_test",
  TEST_DATABASE_SSLMODE: "disable",
};

describe("isolated PostgreSQL test target guard", () => {
  it("accepts only an explicit loopback _test target with a separate role", () => {
    const result = runGuard(safeEnvironment);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("test_database=127.0.0.1:5435/ams_data_hub_test");
    expect(result.stdout).not.toContain(safeEnvironment.TEST_DATABASE_PASSWORD);
  });

  it.each([
    ["non-test APP_ENV", { APP_ENV: "development" }],
    ["non-loopback host", { TEST_DATABASE_HOST: "postgres.internal" }],
    ["development database marker", { TEST_DATABASE_NAME: "ams_data_hub_dev" }],
    ["development identity", { TEST_DATABASE_USER: "ams_data_hub_local" }],
  ])("rejects %s before any lifecycle action", (_label, override) => {
    const result = runGuard({ ...safeEnvironment, ...override });

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain(safeEnvironment.TEST_DATABASE_PASSWORD);
    expect(result.stderr).not.toContain(safeEnvironment.TEST_DATABASE_PASSWORD);
  });

  it("allows the harness only when its application target exactly matches the guarded test target", () => {
    expect(() =>
      readTestDatabaseTarget(
        {
          ...safeEnvironment,
          DATABASE_NAME: safeEnvironment.TEST_DATABASE_NAME,
          DATABASE_USER: safeEnvironment.TEST_DATABASE_USER,
        },
        { allowApplicationTarget: true },
      ),
    ).not.toThrow();

    expect(() =>
      readTestDatabaseTarget(
        {
          ...safeEnvironment,
          DATABASE_NAME: safeEnvironment.TEST_DATABASE_NAME,
          DATABASE_USER: "ams_data_hub_local",
        },
        { allowApplicationTarget: true },
      ),
    ).toThrow("Test and development database names must differ.");
  });

  it("uses peer auth for a root Linux CI worker and explicit host auth on Windows", () => {
    const target = readTestDatabaseTarget(safeEnvironment);
    const linux = createPsqlInvocation(target, { platform: "linux", isRoot: true });
    const windows = createPsqlInvocation(target, { platform: "win32", isRoot: false });

    expect(linux.command).toBe("runuser");
    expect(linux.args.slice(0, 4)).toEqual(["-u", "postgres", "--", "psql"]);
    expect(linux.args).not.toContain("-h");
    expect(windows.command).toBe("psql");
    expect(windows.args).toContain("-h");
    expect(windows.args).toContain("127.0.0.1");
  });
});
