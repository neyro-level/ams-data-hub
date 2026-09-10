const requiredKeys = [
  "TEST_DATABASE_HOST",
  "TEST_DATABASE_USER",
  "TEST_DATABASE_PASSWORD",
  "TEST_DATABASE_NAME",
];

const missingKeys = requiredKeys.filter((key) => !process.env[key]?.trim());
if (missingKeys.length > 0) {
  throw new Error(`Missing isolated test database variables: ${missingKeys.join(", ")}`);
}

const databaseName = process.env.TEST_DATABASE_NAME.trim();
if (!databaseName.endsWith("_test")) {
  throw new Error(`Unsafe test database name: ${databaseName}. Expected a *_test database.`);
}

const databaseUser = process.env.TEST_DATABASE_USER.trim();
if (!/(^|_)test($|_)/i.test(databaseUser)) {
  throw new Error("Unsafe test database identity. Expected a dedicated test role.");
}
if (databaseUser === process.env.LOCAL_POSTGRES_USER?.trim()) {
  throw new Error("Test and development database identities must differ.");
}

const host = process.env.TEST_DATABASE_HOST.trim();
const port = process.env.TEST_DATABASE_PORT?.trim() || "5432";
process.stdout.write(`test_database=${host}:${port}/${databaseName} identity=${databaseUser}\n`);
