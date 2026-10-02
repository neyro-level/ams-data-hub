import type { PoolConfig } from "pg";
import {
  readDatabaseEnvironment,
  type DatabaseEnvironment,
} from "../../config/server-environment.ts";
import { inspectDatabaseTarget } from "../../config/database-target.ts";

export function createPgPoolConfig(databaseUrl: string): PoolConfig {
  const parsed = new URL(databaseUrl);
  const database = parsed.pathname.replace(/^\//, "");

  return {
    host: parsed.hostname,
    port: parsed.port.length > 0 ? Number(parsed.port) : 5432,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
    ssl: parsed.searchParams.get("sslmode") === "disable" ? false : undefined,
  };
}

export function createPgPoolConfigFromEnvironment(env: DatabaseEnvironment): PoolConfig {
  const parsedEnvironment = readDatabaseEnvironment(env);
  inspectDatabaseTarget(env);
  if (
    parsedEnvironment.DATABASE_HOST &&
    parsedEnvironment.DATABASE_USER &&
    parsedEnvironment.DATABASE_PASSWORD &&
    parsedEnvironment.DATABASE_NAME
  ) {
    return {
      host: parsedEnvironment.DATABASE_HOST,
      port: parsedEnvironment.DATABASE_PORT ? Number(parsedEnvironment.DATABASE_PORT) : 5432,
      user: parsedEnvironment.DATABASE_USER,
      password: parsedEnvironment.DATABASE_PASSWORD,
      database: parsedEnvironment.DATABASE_NAME,
      ssl: parsedEnvironment.DATABASE_SSLMODE === "disable" ? false : undefined,
    };
  }

  if (!parsedEnvironment.DATABASE_URL) {
    throw new Error("Database URL is unavailable");
  }
  return createPgPoolConfig(parsedEnvironment.DATABASE_URL);
}
