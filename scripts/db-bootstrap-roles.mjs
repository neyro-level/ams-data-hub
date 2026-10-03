import pg from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const runtimeDatabaseRoles = [
  "ams_data_hub_web",
  "ams_data_hub_worker",
  "ams_data_hub_backup",
];

const passwordEnvironmentNames = {
  ams_data_hub_web: "AMS_DATA_HUB_WEB_DB_PASSWORD",
  ams_data_hub_worker: "AMS_DATA_HUB_WORKER_DB_PASSWORD",
  ams_data_hub_backup: "AMS_DATA_HUB_BACKUP_DB_PASSWORD",
};

function assertPassword(value, role) {
  if (typeof value !== "string" || value.length < 32) {
    throw new Error(`Database role password for ${role} must contain at least 32 characters`);
  }
  if (value.includes("\0")) {
    throw new Error(`Database role password for ${role} contains an unsupported character`);
  }
  return value;
}

export function readRolePasswords(environment, stdinText = "") {
  const fromEnvironment = Object.fromEntries(
    runtimeDatabaseRoles.map((role) => [role, environment[passwordEnvironmentNames[role]]]),
  );
  const configuredCount = Object.values(fromEnvironment).filter(
    (value) => typeof value === "string" && value.length > 0,
  ).length;
  if (configuredCount === runtimeDatabaseRoles.length) {
    return Object.fromEntries(
      runtimeDatabaseRoles.map((role) => [role, assertPassword(fromEnvironment[role], role)]),
    );
  }
  if (configuredCount > 0) {
    throw new Error("Database role passwords must be supplied together through environment variables");
  }

  let parsed;
  try {
    parsed = JSON.parse(stdinText);
  } catch {
    throw new Error("Provide all database role passwords through environment variables or JSON stdin");
  }
  return Object.fromEntries(
    runtimeDatabaseRoles.map((role) => [role, assertPassword(parsed?.[role], role)]),
  );
}

export function validateBootstrapTarget(connectionString, expectedDatabase) {
  let target;
  try {
    target = new URL(connectionString);
  } catch {
    throw new Error("DB_BOOTSTRAP_ADMIN_DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (!["postgres:", "postgresql:"].includes(target.protocol)) {
    throw new Error("DB_BOOTSTRAP_ADMIN_DATABASE_URL must use PostgreSQL");
  }
  const actualDatabase = decodeURIComponent(target.pathname.replace(/^\//, ""));
  if (!expectedDatabase || actualDatabase !== expectedDatabase) {
    throw new Error("DB_BOOTSTRAP_EXPECTED_DATABASE does not match the connection target");
  }
  return { database: actualDatabase };
}

const bootstrapSql = `
DO $bootstrap$
DECLARE
  role_spec record;
BEGIN
  FOR role_spec IN
    SELECT * FROM (VALUES
      ('ams_data_hub_web', 'ams.bootstrap.web_password', 20),
      ('ams_data_hub_worker', 'ams.bootstrap.worker_password', 10),
      ('ams_data_hub_backup', 'ams.bootstrap.backup_password', 2)
    ) AS roles(role_name, password_setting, connection_limit)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_spec.role_name) THEN
      EXECUTE format('CREATE ROLE %I', role_spec.role_name);
    END IF;
    EXECUTE format(
      'ALTER ROLE %I WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT %s PASSWORD %L',
      role_spec.role_name,
      role_spec.connection_limit,
      current_setting(role_spec.password_setting)
    );
  END LOOP;
END
$bootstrap$;
`;

export async function bootstrapDatabaseRoles(client, passwords) {
  await client.query("BEGIN");
  try {
    const capability = await client.query(
      "SELECT r.rolsuper, r.rolcreaterole FROM pg_roles r WHERE r.rolname = current_user",
    );
    const actor = capability.rows[0];
    if (!actor || (!actor.rolsuper && !actor.rolcreaterole)) {
      throw new Error("Database bootstrap identity requires CREATEROLE or superuser capability");
    }

    await client.query("SELECT set_config('ams.bootstrap.web_password', $1, true)", [
      passwords.ams_data_hub_web,
    ]);
    await client.query("SELECT set_config('ams.bootstrap.worker_password', $1, true)", [
      passwords.ams_data_hub_worker,
    ]);
    await client.query("SELECT set_config('ams.bootstrap.backup_password', $1, true)", [
      passwords.ams_data_hub_backup,
    ]);
    await client.query(bootstrapSql);
    const verified = await client.query(
      "SELECT rolname, rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = ANY($1::text[]) ORDER BY rolname",
      [runtimeDatabaseRoles],
    );
    if (
      verified.rows.length !== runtimeDatabaseRoles.length ||
      verified.rows.some(
        (role) =>
          !role.rolcanlogin ||
          role.rolsuper ||
          role.rolcreaterole ||
          role.rolcreatedb ||
          role.rolreplication ||
          role.rolbypassrls,
      )
    ) {
      throw new Error("Database runtime role verification failed");
    }
    await client.query("COMMIT");
    return verified.rows.map((role) => role.rolname);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const connectionString = process.env.DB_BOOTSTRAP_ADMIN_DATABASE_URL?.trim();
  const expectedDatabase = process.env.DB_BOOTSTRAP_EXPECTED_DATABASE?.trim();
  if (!connectionString || !expectedDatabase) {
    throw new Error("DB bootstrap target variables are required");
  }
  validateBootstrapTarget(connectionString, expectedDatabase);
  const passwords = readRolePasswords(process.env, await readStdin());
  const client = new pg.Client({
    connectionString,
    application_name: "ams-data-hub-role-bootstrap",
  });
  await client.connect();
  try {
    const roles = await bootstrapDatabaseRoles(client, passwords);
    process.stdout.write(`database_roles_bootstrap=complete roles=${roles.join(",")}\n`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Database role bootstrap failed"}\n`);
    process.exit(1);
  });
}
