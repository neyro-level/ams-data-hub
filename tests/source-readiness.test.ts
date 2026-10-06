import { describe, expect, it } from "vitest";
import { toWorkerStatus, WORKER_HEARTBEAT_STALE_MS } from "../src/modules/platform-operations/infrastructure/readiness-runtime.ts";
import { assertSourceWorkerId } from "../src/modules/platform-operations/infrastructure/runtime-heartbeat.ts";

describe("source readiness qualification", () => {
  const now = new Date("2026-10-06T12:00:00Z");
  it("requires a finite current heartbeat, rejecting future, stale and invalid clocks", () => {
    expect(toWorkerStatus(null, now)).toBe("unknown");
    expect(toWorkerStatus(now, now)).toBe("healthy");
    expect(toWorkerStatus(new Date(now.getTime() - WORKER_HEARTBEAT_STALE_MS), now)).toBe("healthy");
    expect(toWorkerStatus(new Date(now.getTime() - WORKER_HEARTBEAT_STALE_MS - 1), now)).toBe("stale");
    expect(toWorkerStatus(new Date(now.getTime() + 1), now)).toBe("stale");
    expect(toWorkerStatus(new Date(NaN), now)).toBe("stale");
    expect(toWorkerStatus(now, new Date(NaN))).toBe("stale");
  });
  it.each(["", " ", "x".repeat(129), "worker/other", "worker\n", "secret=https://example.invalid"])("rejects an unsafe owner identity", (workerId) => {
    expect(() => assertSourceWorkerId(workerId)).toThrow("SOURCE_WORKER_ID_INVALID");
  });
  it("accepts a stable configured owner", () => { expect(() => assertSourceWorkerId("ams-source-worker-1")).not.toThrow(); });
  it.each([null, undefined, 123, {}, ["worker"]])("rejects runtime coercion of a non-string owner", (workerId) => {
    expect(() => assertSourceWorkerId(workerId as never)).toThrow("SOURCE_WORKER_ID_INVALID");
  });
});
