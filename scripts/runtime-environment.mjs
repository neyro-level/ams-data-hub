const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/;

function requiredValue(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing required runtime variable: ${name}`);
  return value;
}

function validateDatabaseEnvironment(environment) {
  if (environment.DATABASE_URL?.trim()) return;

  const missing = [
    "DATABASE_HOST",
    "DATABASE_USER",
    "DATABASE_PASSWORD",
    "DATABASE_NAME",
  ].filter((name) => !environment[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required database variables: ${missing.join(", ")}`);
  }
}

export function validateRuntimeEnvironment(role, commandArgs = [], environment = process.env) {
  if (!["web", "worker", "migrator"].includes(role)) {
    throw new Error(`Unknown runtime role: ${role}`);
  }
  if (requiredValue(environment, "APP_ENV") !== "production") {
    throw new Error("APP_ENV must be production in the production runtime");
  }
  if (requiredValue(environment, "NODE_ENV") !== "production") {
    throw new Error("NODE_ENV must be production in the production runtime");
  }

  const releaseSha = requiredValue(environment, "RELEASE_SHA");
  if (!FULL_SHA_PATTERN.test(releaseSha)) {
    throw new Error("RELEASE_SHA must be a full lowercase Git SHA");
  }

  const isRoleBootstrap = role === "migrator" && commandArgs[0] === "bootstrap-roles";
  if (isRoleBootstrap) {
    requiredValue(environment, "DB_BOOTSTRAP_ADMIN_DATABASE_URL");
    requiredValue(environment, "DB_BOOTSTRAP_EXPECTED_DATABASE");
    return { role, mode: "bootstrap-roles", releaseSha };
  }

  validateDatabaseEnvironment(environment);
  if (role === "web") {
    requiredValue(environment, "BETTER_AUTH_SECRET");
    requiredValue(environment, "BETTER_AUTH_URL");
    requiredValue(environment, "BETTER_AUTH_TRUSTED_PROXY_CIDRS");
  }
  if (role === "worker") {
    requiredValue(environment, "OUTBOX_WORKER_ID");
    requiredValue(environment, "PGBOSS_SCHEMA");
  }
  if (role === "migrator") {
    requiredValue(environment, "PGBOSS_SCHEMA");
    requiredValue(environment, "PGBOSS_RUNTIME_ROLE");
  }

  return { role, mode: "runtime", releaseSha };
}
