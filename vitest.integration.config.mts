import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "server-only": path.resolve(import.meta.dirname, "tests/helpers/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    fileParallelism: false,
    setupFiles: ["./tests/setup-test-env.ts"],
    include: [
      "tests/platform-admin.integration.test.ts",
      "tests/auth.authorization.test.ts",
      "tests/health.integration.test.ts",
      "tests/monitoring-service.test.ts",
      "tests/prisma-repositories.test.ts",
      "tests/navigation.test.ts",
      "tests/principal.integration.test.ts",
      "tests/project-reference.integration.test.ts",
      "tests/reliability.integration.test.ts",
      "tests/prisma-sync-repository.test.ts",
      "tests/worker.sync-project.test.ts",
      "tests/tenant-ownership.integration.test.ts",
      "tests/tenant-constraints.integration.test.ts",
      "tests/config-sync.integration.test.ts",
      "tests/setup-token.integration.test.ts",
    ],
  },
});
