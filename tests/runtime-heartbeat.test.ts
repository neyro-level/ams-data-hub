import { describe, expect, it } from "vitest";
import {
  WORKER_HEARTBEAT_STALE_MS,
  toWorkerStatus,
} from "../src/modules/platform-operations/infrastructure/readiness-runtime.ts";

describe("runtime heartbeat readiness", () => {
  const now = new Date("2026-09-06T12:00:00.000Z");

  it("keeps an idle worker healthy while its runtime heartbeat is fresh", () => {
    const heartbeat = new Date(now.getTime() - WORKER_HEARTBEAT_STALE_MS + 1);
    expect(toWorkerStatus(heartbeat, now)).toBe("healthy");
  });

  it("marks a stopped worker stale after the liveness window", () => {
    const heartbeat = new Date(now.getTime() - WORKER_HEARTBEAT_STALE_MS - 1);
    expect(toWorkerStatus(heartbeat, now)).toBe("stale");
  });

  it("reports unknown before the worker has ever started", () => {
    expect(toWorkerStatus(null, now)).toBe("unknown");
  });
});
