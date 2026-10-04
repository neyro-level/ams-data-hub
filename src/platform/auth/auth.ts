import "server-only";

import { prismaAdapter } from "better-auth/adapters/prisma";
import { betterAuth } from "better-auth";
import { twoFactor, username } from "better-auth/plugins";
import { productIdentity } from "../config/product-identity.ts";
import {
  hasDatabaseConfiguration,
  readAuthEnvironment,
} from "../config/server-environment.ts";
import { getPrismaClient } from "../database/prisma/client.ts";
import {
  createAuthIpAddressConfig,
  createAuthRateLimitConfig,
  isTotpVerificationPath,
} from "./security-config.ts";

export function hasAuthConfiguration() {
  return readAuthEnvironment() !== null && hasDatabaseConfiguration();
}

export function isClientAccessEnabled() {
  return readAuthEnvironment()?.clientAccessEnabled ?? false;
}

let initializedAuth: ReturnType<typeof betterAuth> | null | undefined;

export function getAuth() {
  if (initializedAuth !== undefined) return initializedAuth;

  const authEnvironment = readAuthEnvironment();
  const isProductionRuntime = process.env.APP_ENV === "production";
  initializedAuth = hasDatabaseConfiguration() && authEnvironment
    ? betterAuth({
        secret: authEnvironment.secret,
        baseURL: authEnvironment.baseUrl,
        appName: productIdentity.appName,
        session: {
          additionalFields: {
            twoFactorVerifiedAt: {
              type: "date",
              required: false,
              input: false,
            },
          },
        },
        trustedOrigins: [
          authEnvironment.baseUrl,
          ...(process.env.NODE_ENV === "production"
            ? []
            : ["http://127.0.0.1:3000", "http://localhost:3000"]),
        ],
        database: prismaAdapter(getPrismaClient(), {
          provider: "postgresql",
        }),
        emailAndPassword: {
          enabled: true,
          disableSignUp: true,
          minPasswordLength: 12,
          maxPasswordLength: 128,
        },
        rateLimit: createAuthRateLimitConfig(),
        advanced: {
          ipAddress: createAuthIpAddressConfig({
            trustedProxyCidrs: authEnvironment.trustedProxyCidrs,
            isProduction: isProductionRuntime,
          }),
          useSecureCookies: isProductionRuntime,
        },
        databaseHooks: {
          session: {
            create: {
              before: async (session, context) => {
                if (!isTotpVerificationPath(context?.path)) return;
                return { data: { ...session, twoFactorVerifiedAt: new Date() } };
              },
            },
          },
        },
        plugins: [
          twoFactor({
            issuer: productIdentity.appName,
            accountLockout: {
              enabled: true,
              maxFailedAttempts: 10,
              durationSeconds: 15 * 60,
            },
          }),
          username({
            displayUsername: false,
            immutableUsername: true,
            minUsernameLength: 3,
            maxUsernameLength: 30,
          }),
        ],
      }) as unknown as ReturnType<typeof betterAuth>
    : null;
  return initializedAuth;
}
