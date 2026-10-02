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
    include: ["tests/**/*.integration.test.ts"],
  },
});
