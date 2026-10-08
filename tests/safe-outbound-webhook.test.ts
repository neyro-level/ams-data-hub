import { describe, expect, it, vi } from "vitest";
import { executeSafeOutboundWebhook, type SafeOutboundDependencies, type SafeOutboundTransportResponse } from "../src/platform/http/safe-outbound-core.ts";

const signal = { projectId: "synthetic-project", publishSequence: 7 };
function response(status = 204, chunks: Uint8Array[] = [], headers: Record<string, string> = {}): SafeOutboundTransportResponse {
  return { status, headers, body: (async function* () { yield* chunks; })(), abort: vi.fn() };
}
function fixture(reply = response()) {
  const dependencies: SafeOutboundDependencies = { resolve: vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]),
    request: vi.fn(async () => reply) };
  return { dependencies, reply };
}
describe("fixed bounded webhook safe outbound", () => {
  it("sends exactly two fields and accepts empty 204, with two DNS cuts and response cleanup", async () => {
    const f = fixture();
    await executeSafeOutboundWebhook("https://consumer.example/hint", signal, f.dependencies);
    expect(f.dependencies.resolve).toHaveBeenCalledTimes(2);
    const sent = vi.mocked(f.dependencies.request).mock.calls[0]![0];
    expect(JSON.parse(new TextDecoder().decode(sent.jsonBody))).toEqual(signal);
    expect(sent.address).toEqual({ address: "93.184.216.34", family: 4 });
    expect(f.reply.abort).toHaveBeenCalledTimes(1);
  });
  it.each(["http://consumer.example/hint", "https://127.0.0.1/hint", "https://169.254.169.254/hint", "https://[::1]/hint"])("denies unsafe URL %s before transport", async (url) => {
    const f = fixture();
    await expect(executeSafeOutboundWebhook(url, signal, f.dependencies)).rejects.toBeDefined();
    expect(f.dependencies.request).not.toHaveBeenCalled();
  });
  it("denies second-cut DNS rebinding without POST", async () => {
    const f = fixture();
    vi.mocked(f.dependencies.resolve).mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    await expect(executeSafeOutboundWebhook("https://consumer.example/hint", signal, f.dependencies)).rejects.toMatchObject({ code: "TARGET_DENIED" });
    expect(f.dependencies.request).not.toHaveBeenCalled();
  });
  it.each([301, 302, 303, 307, 308])("never follows POST redirect %s", async (status) => {
    const f = fixture(response(status, [], { location: "https://other.example/hint" }));
    await expect(executeSafeOutboundWebhook("https://consumer.example/hint", signal, f.dependencies)).rejects.toMatchObject({ code: "TOO_MANY_REDIRECTS" });
    expect(f.dependencies.request).toHaveBeenCalledTimes(1); expect(f.reply.abort).toHaveBeenCalled();
  });
  it.each(["declared", "streamed", "truncated", "status"])("fails closed and closes %s response", async (mode) => {
    const f = fixture(response(mode === "status" ? 503 : 200, mode === "streamed" ? [new Uint8Array(4097)] : [],
      mode === "declared" ? { "content-length": "4097" } : mode === "truncated" ? { "content-length": "1" } : {}));
    await expect(executeSafeOutboundWebhook("https://consumer.example/hint", signal, f.dependencies)).rejects.toBeDefined();
    expect(f.reply.abort).toHaveBeenCalled();
  });
  it("bounds deadline even for stalled DNS and honors cancellation before transport", async () => {
    const f = fixture(); vi.mocked(f.dependencies.resolve).mockImplementation(() => new Promise(() => {}));
    await expect(executeSafeOutboundWebhook("https://consumer.example/hint", signal, f.dependencies, { timeoutMs: 10 })).rejects.toMatchObject({ code: "TIMEOUT" });
    const controller = new AbortController(); controller.abort();
    const cancelled = fixture();
    await expect(executeSafeOutboundWebhook("https://consumer.example/hint", signal, cancelled.dependencies, { signal: controller.signal })).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(cancelled.dependencies.request).not.toHaveBeenCalled();
  });
  it.each([{ ...signal, datasets: [] }, { ...signal, projectId: "*" }, { ...signal, publishSequence: 0 }, { ...signal, publishSequence: 2_147_483_648 }])("rejects malformed or extra-field signals before DNS", async (notification) => {
    const f = fixture();
    await expect(executeSafeOutboundWebhook("https://consumer.example/hint", notification, f.dependencies)).rejects.toMatchObject({ code: "INVALID_URL" });
    expect(f.dependencies.resolve).not.toHaveBeenCalled();
  });
});
