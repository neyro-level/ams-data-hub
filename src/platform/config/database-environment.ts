import { z } from "zod";

export type EnvironmentSource = Record<string, string | undefined>;

const optionalEnvironmentValue = z.preprocess(
  (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
  z.string().trim().min(1).optional(),
);

const databaseEnvironmentSchema = z
  .object({
    APP_ENV: optionalEnvironmentValue,
    NODE_ENV: optionalEnvironmentValue,
    DATABASE_URL: optionalEnvironmentValue,
    DATABASE_HOST: optionalEnvironmentValue,
    DATABASE_PORT: optionalEnvironmentValue,
    DATABASE_USER: optionalEnvironmentValue,
    DATABASE_PASSWORD: optionalEnvironmentValue,
    DATABASE_NAME: optionalEnvironmentValue,
    DATABASE_SSLMODE: optionalEnvironmentValue,
  })
  .superRefine((value, context) => {
    const componentKeys = [
      "DATABASE_HOST",
      "DATABASE_USER",
      "DATABASE_PASSWORD",
      "DATABASE_NAME",
    ] as const;
    const configuredComponents = componentKeys.filter((key) => value[key] !== undefined);

    if (!value.DATABASE_URL && configuredComponents.length !== componentKeys.length) {
      context.addIssue({
        code: "custom",
        message: "Database configuration is incomplete",
      });
    }
    if (value.DATABASE_PORT) {
      const port = Number(value.DATABASE_PORT);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        context.addIssue({ code: "custom", message: "Database port is invalid" });
      }
    }
    if (value.DATABASE_URL) {
      try {
        const parsed = new URL(value.DATABASE_URL);
        if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
          context.addIssue({ code: "custom", message: "Database URL protocol is invalid" });
        }
      } catch {
        context.addIssue({ code: "custom", message: "Database URL is invalid" });
      }
    }
  });

export type DatabaseEnvironment = z.infer<typeof databaseEnvironmentSchema>;

export function hasDatabaseConfiguration(env: EnvironmentSource = process.env): boolean {
  return Boolean(
    env.DATABASE_URL?.trim() ||
      (env.DATABASE_HOST?.trim() &&
        env.DATABASE_USER?.trim() &&
        env.DATABASE_PASSWORD?.trim() &&
        env.DATABASE_NAME?.trim()),
  );
}

export function parseDatabaseEnvironment(
  env: EnvironmentSource = process.env,
): DatabaseEnvironment {
  const parsed = databaseEnvironmentSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error("Database environment is invalid or incomplete");
  }
  return parsed.data;
}
