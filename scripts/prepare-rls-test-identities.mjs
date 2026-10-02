import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readTestDatabaseTarget } from "./verify-test-database-env.mjs";

const rootDir = path.resolve(import.meta.dirname, "..");
const sqlFile = path.join(rootDir, "scripts", "sql", "prepare-rls-test-identities.sql");

export function createPsqlInvocation(databaseTarget, options = {}) {
  const platform = options.platform ?? process.platform;
  const isRoot = options.isRoot ?? (typeof process.getuid === "function" && process.getuid() === 0);
  const common = [
    "-X",
    "-v", "ON_ERROR_STOP=1",
    "-v", `test_role=${databaseTarget.user}`,
    "-p", String(databaseTarget.port),
    "-d", databaseTarget.database,
    "-f", sqlFile,
  ];
  if (platform !== "win32" && isRoot) {
    return { command: "runuser", args: ["-u", "postgres", "--", "psql", ...common] };
  }
  return {
    command: "psql",
    args: [...common.slice(0, 5), "-h", databaseTarget.host, "-U", "postgres", ...common.slice(5)],
  };
}

function main() {
  const target = readTestDatabaseTarget(process.env, { allowApplicationTarget: true });
  const invocation = createPsqlInvocation(target);
  const result = spawnSync(invocation.command, invocation.args, { cwd: rootDir, stdio: "inherit" });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
