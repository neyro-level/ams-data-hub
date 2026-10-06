import { afterEach, describe, expect, it, vi } from "vitest";
import type { SafeOutboundStreamResult } from "../src/platform/http/safe-outbound.ts";
const gateway = vi.hoisted(() => vi.fn());
vi.mock("../src/platform/http/safe-outbound.ts", async (original) => {
  const actual = await original<typeof import("../src/platform/http/safe-outbound.ts")>();
  return { ...actual, safeOutboundStream: gateway };
});
import { createSourceEndpointResolver } from "../src/modules/ingestion-core/infrastructure/source-endpoint-resolver.ts";
import { defineSecretRef } from "../src/platform/security/secret-ref.ts";
import { SafeOutboundError } from "../src/platform/http/safe-outbound.ts";
import { createLogger } from "../src/platform/observability/logger.ts";

const endpoint = "https://synthetic.example.test/private.xml?token=synthetic-resolver-only";
const reference = defineSecretRef("SYNTHETIC_SOURCE_ENDPOINT_RESOLVER");
const policy = { purpose: "feed" as const, allowedContentTypes: ["application/xml"], maxBytes: 1024 };
afterEach(() => { vi.unstubAllEnvs(); gateway.mockReset(); });

describe("server-only Source endpoint resolution", () => {
  it("resolves environment lazily through SecretRef and returns no final URL", async () => {
    const resolver = createSourceEndpointResolver(reference);
    expect(JSON.stringify(resolver)).toBe('"[SOURCE_ENDPOINT_RESOLVER]"');
    expect(gateway).not.toHaveBeenCalled();
    vi.stubEnv(reference.name, endpoint);
    const close = vi.fn();
    gateway.mockResolvedValue({ status: 200, contentType: "application/xml", contentLength: 4, finalUrl: new URL(endpoint),
      body: (async function* () { yield new TextEncoder().encode("<x/>"); })(), close } satisfies SafeOutboundStreamResult);
    const response = await resolver.acquire(policy);
    expect(gateway).toHaveBeenCalledWith(endpoint, policy);
    expect(JSON.stringify(response)).not.toContain("synthetic.example.test");
    expect(response).not.toHaveProperty("finalUrl");
    for await (const chunk of response.body) expect(chunk.byteLength).toBe(4);
    expect(close).toHaveBeenCalled();
    const lines: string[] = [];
    createLogger(undefined, { write: (chunk) => { lines.push(String(chunk)); return true; } }).info({ anyField: endpoint, resolver });
    expect(lines.join("")).not.toContain(endpoint);
  });

  it("does not expose missing reference names or causes", async () => {
    vi.stubEnv(reference.name, "");
    try { await createSourceEndpointResolver(reference).acquire(policy); throw new Error("UNEXPECTED_SUCCESS"); }
    catch (error) {
      expect(error).toMatchObject({ message: "SOURCE_ENDPOINT_CREDENTIAL_UNAVAILABLE" });
      expect(String(error)).not.toContain(reference.name);
      expect(error).not.toHaveProperty("cause");
    }
    expect(gateway).not.toHaveBeenCalled();
  });

  it("sanitizes thrown intake and delayed body errors without retaining raw cause", async () => {
    vi.stubEnv(reference.name, endpoint);
    gateway.mockRejectedValueOnce(new Error(endpoint));
    await expect(createSourceEndpointResolver(reference).acquire(policy)).rejects.toThrow("SOURCE_ENDPOINT_INTAKE_FAILED");
    const close = vi.fn();
    gateway.mockResolvedValue({ status: 200, contentType: "application/xml", contentLength: null, finalUrl: new URL(endpoint),
      body: { [Symbol.asyncIterator]: () => ({ next: async () => { throw new Error(endpoint); } }) }, close });
    const response = await createSourceEndpointResolver(reference).acquire(policy);
    const consume = async () => { for await (const chunk of response.body) void chunk; };
    await expect(consume()).rejects.toThrow("SOURCE_ENDPOINT_INTAKE_FAILED");
    expect(close).toHaveBeenCalled();
  });

  it("preserves only recognized gateway codes and refuses media-purpose use", async () => {
    vi.stubEnv(reference.name, endpoint);
    gateway.mockRejectedValue(new SafeOutboundError("TARGET_DENIED", endpoint));
    await expect(createSourceEndpointResolver(reference).acquire(policy)).rejects.toThrow("SOURCE_ENDPOINT_TARGET_DENIED");
    await expect(createSourceEndpointResolver(reference).acquire({ ...policy, purpose: "media" })).rejects.toThrow("SOURCE_ENDPOINT_PURPOSE_INVALID");
  });
});
