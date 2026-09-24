import "server-only";

import { prismaAdapter } from "better-auth/adapters/prisma";
import { betterAuth } from "better-auth";
import { twoFactor, username } from "better-auth/plugins";
import {
  hasDatabaseConfiguration,
  readAuthEnvironment,
} from "../config/server-environment.ts";
import { getPrismaClient } from "../database/prisma/client.ts";
import { createAuthRateLimitConfig } from "./security-config.ts";

const authEnvironment = readAuthEnvironment();

export function hasAuthConfiguration() {
  return authEnvironment !== null && hasDatabaseConfiguration();
}

export const auth =
  hasAuthConfiguration() && authEnvironment
      ? betterAuth({
        secret: authEnvironment.secret,
        baseURL: authEnvironment.baseUrl,
        appName: "АМС Старт",
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
          minPasswordLength: 8,
          maxPasswordLength: 128,
        },
        rateLimit: createAuthRateLimitConfig(),
        plugins: [
          twoFactor(),
          username({
            displayUsername: false,
            immutableUsername: true,
            minUsernameLength: 3,
            maxUsernameLength: 30,
          }),
        ],
      })
    : null;
