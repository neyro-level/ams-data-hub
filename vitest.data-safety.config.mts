import path from "node:path";
import { defineConfig } from "vitest/config";

// Dedicated two-process dump/restore proof; not a unit-test or native-lifecycle
// wrapper which would reset the restored database before observing it.
export default defineConfig({
  resolve: { alias: { "server-only": path.resolve(import.meta.dirname, "tests/helpers/server-only.ts") } },
  test: { environment: "node", fileParallelism: false, setupFiles: ["./tests/setup-test-env.ts"],
    include: ["scripts/data-safety-restore.proof.ts"], testTimeout: 60_000 },
});
