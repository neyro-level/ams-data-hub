import path from "node:path";
import { fileURLToPath } from "node:url";

const requiredKeys = [
  "APP_ENV",
  "LOCAL_POSTGRES_USER",
  "TEST_DATABASE_HOST",
  "TEST_DATABASE_USER",
  "TEST_DATABASE_PASSWORD",
  "TEST_DATABASE_NAME",
];

const loopbackHosts = new Set(["127.0.0.1", "::1"]);
const managedHostPattern = /(production|prod|staging|managed|rds|cloudsql|azure|supabase|neon|railway)/i;

function requiredEnvironmentValue(environment, key) {
  const value = environment[key]?.trim();
  if (!value) {
    throw new Error(`Missing isolated test database variable: ${key}`);
  }
  return value;
}

export function readTestDatabaseTarget(environment = process.env) {
  const missingKeys = requiredKeys.filter((key) => !environment[key]?.trim());
  if (missingKeys.length > 0) {
    throw new Error(`Missing isolated test database variables: ${missingKeys.join(", ")}`);
  }

  if (environment.APP_ENV.trim() !== "test") {
    throw new Error("Unsafe test database environment: APP_ENV must be test.");
  }

  const host = requiredEnvironmentValue(environment, "TEST_DATABASE_HOST").toLowerCase();
  if (managedHostPattern.test(host) || !loopbackHosts.has(host)) {
    throw new Error("Unsafe test database host: only a literal loopback host is allowed.");
  }

  const port = Number(environment.TEST_DATABASE_PORT?.trim() || "5432");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Unsafe test database port.");
  }

  const database = requiredEnvironmentValue(environment, "TEST_DATABASE_NAME");
  if (!database.endsWith("_test")) {
    throw new Error(`Unsafe test database name: ${database}. Expected a *_test database.`);
  }
  if (database === environment.DATABASE_NAME?.trim()) {
    throw new Error("Test and development database names must differ.");
  }

  const user = requiredEnvironmentValue(environment, "TEST_DATABASE_USER");
  if (!/(^|_)test($|_)/i.test(user)) {
    throw new Error("Unsafe test database identity. Expected a dedicated test role.");
  }
  if (user === environment.LOCAL_POSTGRES_USER.trim() || user === environment.DATABASE_USER?.trim()) {
    throw new Error("Test and development database identities must differ.");
  }

  return {
    host,
    port,
    database,
    user,
    password: requiredEnvironmentValue(environment, "TEST_DATABASE_PASSWORD"),
    sslmode: environment.TEST_DATABASE_SSLMODE?.trim() || "disable",
  };
}

export function createTestDatabaseUrl(target) {
  const url = new URL("postgresql://localhost");
  url.username = target.user;
  url.password = target.password;
  url.hostname = target.host;
  url.port = String(target.port);
  url.pathname = `/${target.database}`;
  url.searchParams.set("sslmode", target.sslmode);
  return url.toString();
}

function isDirectExecution() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  const target = readTestDatabaseTarget();
  process.stdout.write(`test_database=${target.host}:${target.port}/${target.database} identity=${target.user}\n`);
}
