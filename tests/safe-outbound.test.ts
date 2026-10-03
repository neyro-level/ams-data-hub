import { describe, expect, it, vi } from "vitest";

import {
  executeSafeOutbound,
  type SafeOutboundAddress,
  type SafeOutboundDependencies,
  type SafeOutboundTransportResponse,
} from "../src/platform/http/safe-outbound-core.ts";

const PUBLIC_ADDRESS: SafeOutboundAddress = { address: "93.184.216.34", family: 4 };
const TEXT_POLICY = {
  purpose: "feed" as const,
  allowedContentTypes: ["application/json"],
  timeoutMs: 100,
  maxBytes: 16,
  maxRedirects: 2,
};

function response(
  status: number,
  headers: Record<string, string> = {},
  chunks: Uint8Array[] = [],
): SafeOutboundTransportResponse {
  return {
    status,
    headers,
    body: (async function* () {
      for (const chunk of chunks) yield chunk;
    })(),
    abort: vi.fn(),
  };
}

function dependencies(overrides: Partial<SafeOutboundDependencies> = {}): SafeOutboundDependencies {
  return {
    resolve: vi.fn(async () => [PUBLIC_ADDRESS]),
    request: vi.fn(async () => response(200, { "content-type": "application/json" }, [new TextEncoder().encode("{}")])) ,
    ...overrides,
  };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

describe("Safe Outbound", () => {
  it.each([
    "https://127.0.0.1/data",
    "https://10.0.0.1/data",
    "https://172.16.0.1/data",
    "https://192.168.1.1/data",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/data",
    "https://[fc00::1]/data",
    "https://[fe80::1]/data",
  ])("blocks a private or local literal: %s", async (url) => {
    await expectCode(executeSafeOutbound(url, TEXT_POLICY, dependencies()), "TARGET_DENIED");
  });

  it("blocks hostnames that resolve to a private address", async () => {
    const deps = dependencies({
      resolve: vi.fn(async () => [{ address: "192.168.10.20", family: 4 as const }]),
    });
    await expectCode(executeSafeOutbound("https://feed.example/data", TEXT_POLICY, deps), "TARGET_DENIED");
    expect(deps.request).not.toHaveBeenCalled();
  });

  it("rechecks DNS before dialing and rejects rebinding", async () => {
    const resolve = vi.fn()
      .mockResolvedValueOnce([PUBLIC_ADDRESS])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 as const }]);
    const deps = dependencies({ resolve });
    await expectCode(executeSafeOutbound("https://feed.example/data", TEXT_POLICY, deps), "TARGET_DENIED");
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(deps.request).not.toHaveBeenCalled();
  });

  it("revalidates a redirect target and blocks a private destination", async () => {
    const deps = dependencies({
      request: vi.fn(async () => response(302, { location: "http://127.0.0.1/private" })),
    });
    await expectCode(executeSafeOutbound("https://feed.example/data", TEXT_POLICY, deps), "PROTOCOL_DENIED");
  });

  it("blocks a private HTTPS destination after redirect", async () => {
    const deps = dependencies({
      request: vi.fn(async () => response(302, { location: "https://127.0.0.1/private" })),
    });
    await expectCode(executeSafeOutbound("https://feed.example/data", TEXT_POLICY, deps), "TARGET_DENIED");
  });

  it("stops streaming when the byte limit is exceeded", async () => {
    const deps = dependencies({
      request: vi.fn(async () => response(200, { "content-type": "application/json" }, [
        new Uint8Array(10),
        new Uint8Array(10),
      ])),
    });
    await expectCode(executeSafeOutbound("https://feed.example/data", TEXT_POLICY, deps), "RESPONSE_TOO_LARGE");
  });

  it("rejects a declared content length above the byte limit", async () => {
    const deps = dependencies({
      request: vi.fn(async () => response(200, {
        "content-type": "application/json",
        "content-length": "17",
      })),
    });
    await expectCode(executeSafeOutbound("https://feed.example/data", TEXT_POLICY, deps), "RESPONSE_TOO_LARGE");
  });

  it("enforces an end-to-end timeout", async () => {
    const deps = dependencies({
      request: vi.fn(() => new Promise<SafeOutboundTransportResponse>(() => undefined)),
    });
    await expectCode(executeSafeOutbound("https://feed.example/data", {
      ...TEXT_POLICY,
      timeoutMs: 10,
    }, deps), "TIMEOUT");
  });

  it("rejects an unapproved content type", async () => {
    const deps = dependencies({
      request: vi.fn(async () => response(200, { "content-type": "text/html" })),
    });
    await expectCode(executeSafeOutbound("https://feed.example/data", TEXT_POLICY, deps), "CONTENT_TYPE_DENIED");
  });

  it("allows HTTP only for an explicitly enabled media profile", async () => {
    const deps = dependencies();
    await expectCode(executeSafeOutbound("http://media.example/file", TEXT_POLICY, deps), "PROTOCOL_DENIED");

    const result = await executeSafeOutbound("http://media.example/file", {
      purpose: "media",
      allowHttpForMedia: true,
      allowedContentTypes: ["application/json"],
    }, deps);
    expect(result.status).toBe(200);
  });
});
