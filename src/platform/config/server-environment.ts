import { z } from "zod";
import { isIP } from "node:net";
import {
  defineSecretRef,
  resolveSecretRef,
  type SecretValue,
} from "../security/secret-ref.ts";
import {
  parseDatabaseEnvironment,
  type DatabaseEnvironment,
  type EnvironmentSource,
} from "./database-environment.ts";

export { hasDatabaseConfiguration } from "./database-environment.ts";
export type { DatabaseEnvironment } from "./database-environment.ts";

const databaseUrlSecretRef = defineSecretRef("DATABASE_URL");
const databasePasswordSecretRef = defineSecretRef("DATABASE_PASSWORD");
const betterAuthSecretRef = defineSecretRef("BETTER_AUTH_SECRET");

const optionalEnvironmentValue = z.preprocess(
  (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
  z.string().trim().min(1).optional(),
);

export function readDatabaseEnvironment(
  env: EnvironmentSource = process.env,
): DatabaseEnvironment {
  const parsed = parseDatabaseEnvironment(env);
  if (parsed.DATABASE_URL) {
    resolveSecretRef(databaseUrlSecretRef, { DATABASE_URL: parsed.DATABASE_URL });
  }
  if (parsed.DATABASE_PASSWORD) {
    resolveSecretRef(databasePasswordSecretRef, { DATABASE_PASSWORD: parsed.DATABASE_PASSWORD });
  }
  return parsed;
}

const authEnvironmentSchema = z.object({
  BETTER_AUTH_SECRET: z.string().trim().min(32),
  BETTER_AUTH_URL: z.string().trim().url(),
  BETTER_AUTH_TRUSTED_PROXY_CIDRS: optionalEnvironmentValue,
  CLIENT_ACCESS_ENABLED: optionalEnvironmentValue,
});

export interface AuthEnvironment {
  secret: SecretValue;
  baseUrl: string;
  trustedProxyCidrs: string[];
  clientAccessEnabled: boolean;
}

function parseExplicitBoolean(value: string | undefined, name: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function parseTrustedProxyCidrs(value: string | undefined): string[] {
  if (!value) return [];

  const cidrs = value.split(",").map((item) => item.trim()).filter(Boolean);
  for (const cidr of cidrs) {
    const [address, prefix] = cidr.split("/");
    const ipVersion = address ? isIP(address) : 0;
    const maxPrefix = ipVersion === 6 ? 128 : ipVersion === 4 ? 32 : 0;
    const prefixValue = prefix === undefined ? null : Number(prefix);
    if (!address || ipVersion === 0 || (prefix !== undefined && (!Number.isInteger(prefixValue) || prefixValue! < 0 || prefixValue! > maxPrefix))) {
      throw new Error("BETTER_AUTH_TRUSTED_PROXY_CIDRS contains an invalid IP or CIDR range");
    }
  }
  return cidrs;
}

export function readAuthEnvironment(
  env: EnvironmentSource = process.env,
): AuthEnvironment | null {
  const secret = env.BETTER_AUTH_SECRET?.trim();
  const baseUrl = env.BETTER_AUTH_URL?.trim();
  if (!secret && !baseUrl) {
    return null;
  }

  const parsed = authEnvironmentSchema.safeParse({
    BETTER_AUTH_SECRET: secret,
    BETTER_AUTH_URL: baseUrl,
    BETTER_AUTH_TRUSTED_PROXY_CIDRS: env.BETTER_AUTH_TRUSTED_PROXY_CIDRS,
    CLIENT_ACCESS_ENABLED: env.CLIENT_ACCESS_ENABLED,
  });
  if (!parsed.success) {
    throw new Error("Better Auth environment is invalid or incomplete");
  }

  const url = new URL(parsed.data.BETTER_AUTH_URL);
  const isLoopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !isLoopback) {
    throw new Error("Better Auth URL must use HTTPS outside loopback development");
  }

  return {
    secret: resolveSecretRef(betterAuthSecretRef, {
      BETTER_AUTH_SECRET: parsed.data.BETTER_AUTH_SECRET,
    }),
    baseUrl: url.origin,
    trustedProxyCidrs: parseTrustedProxyCidrs(parsed.data.BETTER_AUTH_TRUSTED_PROXY_CIDRS),
    clientAccessEnabled: parseExplicitBoolean(
      parsed.data.CLIENT_ACCESS_ENABLED,
      "CLIENT_ACCESS_ENABLED",
      false,
    ),
  };
}

const releaseShaSchema = z.string().regex(/^[0-9a-f]{40}$/);

export function readReleaseSha(env: EnvironmentSource = process.env): string | null {
  const value = env.RELEASE_SHA?.trim();
  if (!value) {
    return null;
  }

  const parsed = releaseShaSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("RELEASE_SHA must be a full lowercase Git SHA");
  }
  return parsed.data;
}
