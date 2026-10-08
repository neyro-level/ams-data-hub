import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { stopOwnedTestChild } from "./helpers/owned-test-child.ts";

function fixture(termination: "graceful" | "forced" | "never", exited = false) {
  const emitter = new EventEmitter();
  const kill = vi.fn((signal: NodeJS.Signals) => {
    if (termination === "graceful" || (termination === "forced" && signal === "SIGKILL"))
      setTimeout(() => emitter.emit("close"), 1);
    return true;
  });
  return { child: Object.assign(emitter, { exitCode: exited ? 0 : null, signalCode: null, kill }) as unknown as ChildProcess, kill, emitter };
}
describe("bounded cleanup of an exact owned test child", () => {
  it("does not signal an already exited child", async () => {
    const f = fixture("never", true); await stopOwnedTestChild(f.child); expect(f.kill).not.toHaveBeenCalled();
  });
  it.each(["graceful", "forced", "never"] as const)("bounds $0 cleanup and joins close or rejects", async (termination) => {
    vi.useFakeTimers(); const f = fixture(termination);
    try {
      const operation = stopOwnedTestChild(f.child);
      const outcome = termination === "never" ? expect(operation).rejects.toThrow("SYNTHETIC_OWNED_CHILD_CLEANUP_TIMEOUT")
        : expect(operation).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync(7_010); await outcome;
      expect(f.kill.mock.calls.map(([signal]) => signal)).toEqual(termination === "graceful" ? ["SIGTERM"] : ["SIGTERM", "SIGKILL"]);
      expect(f.emitter.listenerCount("close")).toBe(0); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
