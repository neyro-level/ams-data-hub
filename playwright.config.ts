import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "line",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "node --env-file-if-exists=.env.local node_modules/prisma/build/index.js migrate deploy && node --env-file-if-exists=.env.local scripts/pgboss-migrate.mjs && node --env-file-if-exists=.env.local node_modules/tsx/dist/cli.mjs scripts/seed-e2e-admin.ts --confirm-local-e2e && node --env-file-if-exists=.env.local .next/standalone/server.js",
    url: `${baseURL}/api/health/live`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      HOSTNAME: "127.0.0.1",
      PORT: "3100",
      NODE_ENV: "production",
      BETTER_AUTH_SECRET: "e2e-only-secret-at-least-thirty-two-characters",
      BETTER_AUTH_URL: baseURL,
      APP_ENV: "test",
    },
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "mobile-375",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 812 },
        extraHTTPHeaders: { "x-forwarded-for": "192.0.2.11" },
      },
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
    },
    {
      name: "tablet-768",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 768, height: 1024 },
        extraHTTPHeaders: { "x-forwarded-for": "192.0.2.12" },
      },
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
    },
    {
      name: "desktop-1280",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        extraHTTPHeaders: { "x-forwarded-for": "192.0.2.13" },
      },
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
    },
    {
      name: "desktop-1440",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        extraHTTPHeaders: { "x-forwarded-for": "192.0.2.14" },
      },
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
    },
  ],
});
