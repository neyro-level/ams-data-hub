import type { DatabaseEnvironment } from "./server-environment.ts";
import { readDatabaseEnvironment } from "./server-environment.ts";

type EnvironmentSource = DatabaseEnvironment & {
  APP_ENV?: string;
  NODE_ENV?: string;
};

export type DatabaseTargetEnvironment = "development" | "test" | "production";

export interface DatabaseTargetSummary {
  environment: DatabaseTargetEnvironment;
  host: string;
  port: number;
  database: string;
  identity: string;
}

function targetError(message: string): never {
  throw new Error(`Unsafe database target: ${message}`);
}

function parseUrlTarget(value: string) {
  const parsed = new URL(value);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    identity: decodeURIComponent(parsed.username),
  };
}

function resolveEnvironment(
  env: EnvironmentSource,
  database: string,
): DatabaseTargetEnvironment {
  const applicationEnvironment = env.APP_ENV?.trim();
  if (
    applicationEnvironment === "production" ||
    applicationEnvironment === "test" ||
    applicationEnvironment === "development"
  ) {
    return applicationEnvironment;
  }
  if (database.endsWith("_test")) {
    return "test";
  }
  const nodeEnvironment = env.NODE_ENV?.trim();
  if (
    nodeEnvironment === "production" ||
    nodeEnvironment === "test" ||
    nodeEnvironment === "development"
  ) {
    return nodeEnvironment;
  }
  return "development";
}

export function inspectDatabaseTarget(env: EnvironmentSource): DatabaseTargetSummary {
  const parsed = readDatabaseEnvironment(env);
  const urlTarget = parsed.DATABASE_URL ? parseUrlTarget(parsed.DATABASE_URL) : null;
  const componentTarget =
    parsed.DATABASE_HOST && parsed.DATABASE_USER && parsed.DATABASE_PASSWORD && parsed.DATABASE_NAME
      ? {
          host: parsed.DATABASE_HOST,
          port: parsed.DATABASE_PORT ? Number(parsed.DATABASE_PORT) : 5432,
          database: parsed.DATABASE_NAME,
          identity: parsed.DATABASE_USER,
        }
      : null;

  if (urlTarget && componentTarget) {
    const sameTarget =
      urlTarget.host === componentTarget.host &&
      urlTarget.port === componentTarget.port &&
      urlTarget.database === componentTarget.database &&
      urlTarget.identity === componentTarget.identity;
    if (!sameTarget) {
      targetError("DATABASE_URL and component configuration identify different databases");
    }
  }

  const target = componentTarget ?? urlTarget;
  if (!target || !target.host || !target.database || !target.identity) {
    targetError("explicit host, database and identity are required");
  }

  const environment = resolveEnvironment(env, target.database);
  if (environment === "test") {
    if (!target.database.endsWith("_test")) {
      targetError("test database name must end with _test");
    }
    if (!/(^|_)test($|_)/i.test(target.identity)) {
      targetError("test database requires a dedicated test identity");
    }
  } else if (environment === "development") {
    if (!target.database.endsWith("_dev")) {
      targetError("development database name must end with _dev");
    }
    if (!/(local|dev)/i.test(target.identity)) {
      targetError("development database requires a local/development identity");
    }
  } else {
    if (target.database.endsWith("_test") || target.database.endsWith("_dev")) {
      targetError("production cannot use a test or development database");
    }
    if (/(test|local|dev)/i.test(target.identity)) {
      targetError("production cannot use a test or development identity");
    }
  }

  return { environment, ...target };
}

export function formatDatabaseTargetSummary(target: DatabaseTargetSummary): string {
  return [
    `environment=${target.environment}`,
    `host=${target.host}`,
    `port=${target.port}`,
    `database=${target.database}`,
    `identity=${target.identity}`,
  ].join(" ");
}
