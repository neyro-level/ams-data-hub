import { describe, expect, it } from "vitest";
import { liveHealthSchema, readyHealthSchema } from "../src/platform/http/health.ts";

const releaseSha = "a".repeat(40);
const correlationId = "00000000-0000-4000-8000-000000000000";

describe("health contracts", () => {
  it("accepts neutral live service id", () => {
    expect(
      liveHealthSchema.parse({
        status: "ok",
        service: "ams-data-hub",
        releaseSha,
        correlationId,
        time: new Date().toISOString(),
      }).service,
    ).toBe("ams-data-hub");
  });

  it("does not require provider freshness in readiness", () => {
    expect(
      readyHealthSchema.parse({
        status: "ready",
        service: "ams-data-hub",
        releaseSha: null,
        correlationId,
        dependencies: {
          postgresql: "ready",
          auth: "configured",
          outbox: { status: "healthy", pending: 0, processing: 0, deadLetter: 0 },
          worker: { status: "unknown", lastHeartbeatAt: null },
        },
      }).dependencies.outbox.status,
    ).toBe("healthy");
  });
});
