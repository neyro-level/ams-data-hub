import { describe, expect, it, vi } from "vitest";
import { executeSafeOutboundStream, type SafeOutboundAddress, type SafeOutboundDependencies, type SafeOutboundTransportResponse } from "../src/platform/http/safe-outbound-core.ts";

const publicAddress: SafeOutboundAddress = { address: "93.184.216.34", family: 4 };
const policy = { purpose: "feed" as const, allowedContentTypes: ["application/xml"], maxBytes: 16, timeoutMs: 100, maxRedirects: 2 };
function response(headers: Record<string, string | undefined> = { "content-type": "application/xml" }, chunks = [new Uint8Array([1, 2])], status = 200): SafeOutboundTransportResponse {
  return { status, headers, abort: vi.fn(), body: (async function* () { for (const chunk of chunks) yield chunk; })() };
}
function dependencies(value = response()): SafeOutboundDependencies {
  return { resolve: vi.fn(async () => [publicAddress]), request: vi.fn(async () => value) };
}
async function consume(value: Promise<Awaited<ReturnType<typeof executeSafeOutboundStream>>>) {
  const result = await value;
  try { for await (const chunk of result.body) void chunk; } finally { result.close(); }
}

describe("streaming outbound security parity", () => {
  it.each(["http://feed.example.test/data", "file:///feed.xml", "ftp://feed.example.test/data"])("denies a non-HTTPS feed %s", async (url) => {
    const deps = dependencies();
    await expect(executeSafeOutboundStream(url, policy, deps)).rejects.toMatchObject({ code: "PROTOCOL_DENIED" });
    expect(deps.request).not.toHaveBeenCalled();
  });

  it.each(["https://127.0.0.1/data", "https://10.0.0.1/data", "https://169.254.169.254/data", "https://[::1]/data", "https://[fc00::1]/data", "https://[::ffff:127.0.0.1]/data", "https://[::ffff:7f00:1]/data", "https://localhost./data"])("blocks a private or mapped literal %s", async (url) => {
    const deps = dependencies();
    await expect(executeSafeOutboundStream(url, policy, deps)).rejects.toMatchObject({ code: "TARGET_DENIED" });
    expect(deps.request).not.toHaveBeenCalled();
  });

  it.each(["::ffff:127.0.0.1", "::ffff:7f00:1", "0:0:0:0:0:ffff:7f00:1"])("blocks mapped DNS result %s", async (address) => {
    const deps = dependencies();
    deps.resolve = async () => [{ address, family: 6 }];
    await expect(executeSafeOutboundStream("https://feed.example.test/data", policy, deps)).rejects.toMatchObject({ code: "TARGET_DENIED" });
    expect(deps.request).not.toHaveBeenCalled();
  });

  it("rejects rebinding at the second validation and checks every DNS address", async () => {
    const deps = dependencies();
    deps.resolve = vi.fn().mockResolvedValueOnce([publicAddress]).mockResolvedValueOnce([publicAddress, { address: "10.0.0.1", family: 4 }]);
    await expect(executeSafeOutboundStream("https://feed.example.test/data", policy, deps)).rejects.toMatchObject({ code: "TARGET_DENIED" });
    expect(deps.resolve).toHaveBeenCalledTimes(2);
    expect(deps.request).not.toHaveBeenCalled();
  });

  it("passes only the second public address to the socket transport", async () => {
    const deps = dependencies();
    const second = { address: "1.1.1.1", family: 4 as const };
    deps.resolve = vi.fn().mockResolvedValueOnce([publicAddress]).mockResolvedValueOnce([second]);
    const result = await executeSafeOutboundStream("https://feed.example.test/data", policy, deps);
    expect(deps.request).toHaveBeenCalledWith(expect.objectContaining({ address: second, accept: "application/xml" }));
    result.close();
  });

  it("aborts a redirect response and rejects its private destination before dialing", async () => {
    const redirect = response({ location: "https://127.0.0.1/private" }, [], 302);
    const deps = dependencies(redirect);
    await expect(executeSafeOutboundStream("https://feed.example.test/data", policy, deps)).rejects.toMatchObject({ code: "TARGET_DENIED" });
    expect(deps.request).toHaveBeenCalledTimes(1);
    expect(redirect.abort).toHaveBeenCalled();
  });

  it("revalidates a safe redirect with two additional DNS validations", async () => {
    const redirect = response({ location: "/next" }, [], 307);
    const deps = dependencies();
    deps.request = vi.fn().mockResolvedValueOnce(redirect).mockResolvedValueOnce(response());
    await consume(executeSafeOutboundStream("https://feed.example.test/data", policy, deps));
    expect(deps.resolve).toHaveBeenCalledTimes(4);
    expect(deps.request).toHaveBeenCalledTimes(2);
    expect(redirect.abort).toHaveBeenCalled();
  });

  it.each([
    { headers: { "content-type": "text/html" }, code: "CONTENT_TYPE_DENIED" },
    { headers: { "content-type": "application/xml", "content-length": "17" }, code: "RESPONSE_TOO_LARGE" },
    { headers: { "content-type": "application/xml", "content-length": "invalid" }, code: "RESPONSE_TOO_LARGE" },
  ])("aborts a denied response before consuming bytes: $code", async ({ headers, code }) => {
    const value = response(headers);
    await expect(executeSafeOutboundStream("https://feed.example.test/data", policy, dependencies(value))).rejects.toMatchObject({ code });
    expect(value.abort).toHaveBeenCalled();
  });

  it("aborts an oversized body and returns the upstream iterator", async () => {
    let returned = false;
    const value = response();
    value.body = (async function* () { try { yield new Uint8Array(10); yield new Uint8Array(10); } finally { returned = true; } })();
    await expect(consume(executeSafeOutboundStream("https://feed.example.test/data", policy, dependencies(value)))).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
    expect(value.abort).toHaveBeenCalled();
    expect(returned).toBe(true);
  });

  it("aborts a stalled body at the whole-request deadline", async () => {
    const value = response();
    value.body = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }) };
    await expect(consume(executeSafeOutboundStream("https://feed.example.test/data", { ...policy, timeoutMs: 10 }, dependencies(value)))).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(value.abort).toHaveBeenCalled();
  });

  it("aborts even an unconsumed response at the deadline", async () => {
    const value = response();
    const result = await executeSafeOutboundStream("https://feed.example.test/data", { ...policy, timeoutMs: 10 }, dependencies(value));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(value.abort).toHaveBeenCalled();
    result.close();
  });

  it("closes a response that arrives after a request timeout", async () => {
    const value = response();
    const deps = dependencies();
    let deliver: ((result: SafeOutboundTransportResponse) => void) | undefined;
    deps.request = () => new Promise((resolve) => { deliver = resolve; });
    await expect(executeSafeOutboundStream("https://feed.example.test/data", { ...policy, timeoutMs: 10 }, deps)).rejects.toMatchObject({ code: "TIMEOUT" });
    deliver!(value);
    await Promise.resolve();
    expect(value.abort).toHaveBeenCalled();
  });

  it("aborts early consumer termination and detects truncated bodies", async () => {
    const value = response();
    const result = await executeSafeOutboundStream("https://feed.example.test/data", policy, dependencies(value));
    for await (const chunk of result.body) { expect(chunk.byteLength).toBe(2); break; }
    expect(value.abort).toHaveBeenCalled();
    await expect(consume(executeSafeOutboundStream("https://feed.example.test/data", policy, dependencies(response({ "content-type": "application/xml", "content-length": "3" }))))).rejects.toMatchObject({ code: "RESPONSE_TRUNCATED" });
  });
});
