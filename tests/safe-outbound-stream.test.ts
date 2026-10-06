import { describe, expect, it, vi } from "vitest";
import { executeSafeOutbound, executeSafeOutboundStream, type SafeOutboundDependencies } from "../src/platform/http/safe-outbound-core.ts";

const policy = { purpose: "feed" as const, allowedContentTypes: ["application/xml"], maxBytes: 64 * 1024 * 1024, timeoutMs: 1000 };

describe("explicit outbound modes", () => {
  it("does not pull or materialize feed bytes before the consumer requests them", async () => {
    let pulls = 0;
    const abort = vi.fn();
    const chunk = new Uint8Array(64 * 1024);
    const dependencies: SafeOutboundDependencies = {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async () => ({ status: 200, headers: { "content-type": "application/xml" }, abort, body: (async function* () { for (let index = 0; index < 1024; index++) { pulls++; yield chunk; } })() }),
    };
    const response = await executeSafeOutboundStream("https://feed.example.test/data", policy, dependencies);
    expect(pulls).toBe(0);
    let bytes = 0;
    for await (const current of response.body) {
      expect(current).toBe(chunk);
      bytes += current.byteLength;
    }
    expect(bytes).toBe(64 * 1024 * 1024);
    expect(pulls).toBe(1024);
    expect(abort).toHaveBeenCalled();
    await expect(executeSafeOutbound("https://feed.example.test/data", policy, dependencies)).rejects.toMatchObject({ code: "INVALID_URL" });
  });

  it("retains byte-exact buffered media compatibility with its smaller bound", async () => {
    const dependencies: SafeOutboundDependencies = {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async () => ({ status: 200, headers: { "content-type": "image/png" }, abort: vi.fn(), body: (async function* () { yield new Uint8Array([1, 2]); yield new Uint8Array([3]); })() }),
    };
    const result = await executeSafeOutbound("https://media.example.test/image", { purpose: "media", allowedContentTypes: ["image/png"] }, dependencies);
    expect(result.body).toEqual(new Uint8Array([1, 2, 3]));
    await expect(executeSafeOutboundStream("https://media.example.test/image", { purpose: "media", allowedContentTypes: ["image/png"] }, dependencies)).rejects.toMatchObject({ code: "PROTOCOL_DENIED" });
  });
});
