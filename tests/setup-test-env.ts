const mapping = {
  TEST_DATABASE_HOST: "DATABASE_HOST",
  TEST_DATABASE_PORT: "DATABASE_PORT",
  TEST_DATABASE_USER: "DATABASE_USER",
  TEST_DATABASE_PASSWORD: "DATABASE_PASSWORD",
  TEST_DATABASE_NAME: "DATABASE_NAME",
  TEST_DATABASE_SSLMODE: "DATABASE_SSLMODE",
} as const;

for (const [from, to] of Object.entries(mapping)) {
  const value = process.env[from];
  if (value && !process.env[to]) {
    process.env[to] = value;
  }
}
