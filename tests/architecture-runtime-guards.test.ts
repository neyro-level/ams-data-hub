import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inspectRuntimeComposition, REQUIRED_COMPOSITION_FILES } from "../scripts/architecture-runtime-guards.mjs";

describe("production composition removal guards", () => {
  it.each(REQUIRED_COMPOSITION_FILES)("accepts the actual production composition: %s", (file) => {
    expect(inspectRuntimeComposition(file, readFileSync(file, "utf8"))).toEqual([]);
    expect(inspectRuntimeComposition(file, "// imports alone cannot execute production\n")).not.toEqual([]);
  });

  it.each([
    "createSnapshotBuildCapability", "createOperationalSnapshotPublishCapability", "createPrismaSourceJobRepository",
    "createPrismaSourceManualRequests", "runSourceWorkerWithDependencies", "dispatchSourceManualRequest",
    "handleOperationalOutboxEvent", "createSourceExecutionServer", "reconcileSchedules", "snapshotBuild",
  ])("rejects removal of concrete source-worker binding %s while imports remain", (binding) => {
    const file = "src/infrastructure/source-worker-runtime.ts";
    const source = readFileSync(file, "utf8");
    const removed = source.replace(new RegExp(`\\b${binding}\\(`, "gu"), "removedBinding(");
    expect(removed).not.toBe(source);
    expect(inspectRuntimeComposition(file, removed).some((failure: string) => failure.includes(`-> ${binding}:`))).toBe(true);
  });

  it.each(REQUIRED_COMPOSITION_FILES.filter((file: string) => file.includes("/api/snapshots/")))(
    "rejects a stub route leaving real handler imports in place: %s", (file) => {
      const source = readFileSync(file, "utf8");
      const removed = source.replace(/return handleSnapshotConsumer(?:Get|Ack)\([^;]+;/u, "return new Response('stub');");
      expect(removed).not.toBe(source);
      expect(inspectRuntimeComposition(file, removed).some((failure: string) => failure.includes("Missing production binding"))).toBe(true);
      expect(inspectRuntimeComposition(file, source.replace("export async function", "async function")))
        .toContainEqual(expect.stringContaining("Missing production entrypoint"));
    },
  );

  it("rejects an unused CLI main and removing only its source-worker branch", () => {
    const file = "src/worker/main.ts";
    const source = readFileSync(file, "utf8");
    expect(inspectRuntimeComposition(file, source.replace("main().finally", "removedMain().finally")))
      .toContain(`Missing production CLI startup: ${file}`);
    expect(inspectRuntimeComposition(file, source.replace("? runSourceWorker : runOutboxWorker", "? runOutboxWorker : runOutboxWorker")))
      .toContain(`Missing production binding main -> runSourceWorker: ${file}`);
  });
});
