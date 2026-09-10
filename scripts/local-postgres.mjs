import pg from "pg";

const mode = process.argv[2] ?? "status";
const allowedModes = new Set(["start", "status", "stop"]);

if (!allowedModes.has(mode)) {
  throw new Error(`Unsupported local PostgreSQL mode: ${mode}`);
}

if (mode === "stop") {
  console.log("native_postgresql=left_running reason=shared_windows_service");
  process.exit(0);
}

function readTarget() {
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    return {
      host: url.hostname,
      port: Number(url.port || 5432),
      database: url.pathname.slice(1),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      ssl: url.searchParams.get("sslmode") === "require",
    };
  }

  return {
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT || 5432),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    ssl: process.env.DATABASE_SSLMODE === "require",
  };
}

const target = readTarget();
if (!new Set(["127.0.0.1", "localhost"]).has(target.host)) {
  throw new Error("Local PostgreSQL must use a loopback host");
}
if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535) {
  throw new Error("Local PostgreSQL port is invalid");
}
if (!target.database?.endsWith("_dev") || !target.user?.includes("local") || !target.password) {
  throw new Error("Local PostgreSQL requires a dedicated development database and role");
}

const client = new pg.Client({
  host: target.host,
  port: target.port,
  database: target.database,
  user: target.user,
  password: target.password,
  ssl: target.ssl,
  connectionTimeoutMillis: 5_000,
});

try {
  await client.connect();
  const result = await client.query("select current_user, current_database(), current_setting('server_version') as server_version");
  const row = result.rows[0];
  if (row.current_user !== target.user || row.current_database !== target.database) {
    throw new Error("Connected PostgreSQL identity does not match local project configuration");
  }
  console.log(`native_postgresql=ready host=${target.host} port=${target.port} database=${row.current_database} identity=${row.current_user} version=${row.server_version}`);
} finally {
  await client.end().catch(() => undefined);
}
