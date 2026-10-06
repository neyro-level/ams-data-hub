import "server-only";

import { BlockList, isIP } from "node:net";

export type SafeOutboundPurpose = "feed" | "media";

export interface SafeOutboundPolicy {
  purpose: SafeOutboundPurpose;
  allowedContentTypes: readonly string[];
  allowHttpForMedia?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export interface SafeOutboundAddress {
  address: string;
  family: 4 | 6;
}

export interface SafeOutboundTransportResponse {
  status: number;
  headers: Readonly<Record<string, string | undefined>>;
  body: AsyncIterable<Uint8Array>;
  abort(): void;
}

export interface SafeOutboundTransportRequest {
  url: URL;
  address: SafeOutboundAddress;
  accept: string;
  signal: AbortSignal;
}

export interface SafeOutboundDependencies {
  resolve(hostname: string): Promise<readonly SafeOutboundAddress[]>;
  request(input: SafeOutboundTransportRequest): Promise<SafeOutboundTransportResponse>;
}

export interface SafeOutboundResult {
  status: number;
  contentType: string;
  body: Uint8Array;
  finalUrl: URL;
}

export interface SafeOutboundStreamResult {
  status: number;
  contentType: string;
  contentLength: number | null;
  body: AsyncIterable<Uint8Array>;
  finalUrl: URL;
  /** Required when abandoning a response without consuming its body. */
  close(): void;
}

export type SafeOutboundErrorCode =
  | "INVALID_URL"
  | "PROTOCOL_DENIED"
  | "TARGET_DENIED"
  | "DNS_FAILED"
  | "REDIRECT_DENIED"
  | "TOO_MANY_REDIRECTS"
  | "TIMEOUT"
  | "RESPONSE_TOO_LARGE"
  | "RESPONSE_TRUNCATED"
  | "CONTENT_TYPE_DENIED"
  | "HTTP_STATUS_DENIED";

export class SafeOutboundError extends Error {
  public constructor(
    public readonly code: SafeOutboundErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SafeOutboundError";
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const MAX_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 50 * 1024 * 1024;
const MAX_STREAM_BYTES = 256 * 1024 * 1024;

const blockedAddresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["100::", 64],
  ["2001:2::", 48],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv6");
}

function boundedInteger(value: number | undefined, fallback: number, maximum: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > maximum) {
    throw new SafeOutboundError("INVALID_URL", `${label} is outside the approved outbound limit`);
  }
  return resolved;
}

function normalizeHostname(hostname: string): string {
  const withoutBrackets = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  return withoutBrackets.replace(/\.$/, "").toLowerCase();
}

function assertProtocol(url: URL, policy: SafeOutboundPolicy): void {
  const httpAllowed = policy.purpose === "media" && policy.allowHttpForMedia === true;
  if (url.protocol !== "https:" && !(httpAllowed && url.protocol === "http:")) {
    throw new SafeOutboundError("PROTOCOL_DENIED", "Outbound URL protocol is not allowed");
  }
  if (url.username || url.password) {
    throw new SafeOutboundError("INVALID_URL", "Outbound URL credentials are forbidden");
  }
}

function assertAddress(address: SafeOutboundAddress): void {
  const detectedFamily = isIP(address.address);
  if (detectedFamily !== address.family) {
    throw new SafeOutboundError("DNS_FAILED", "DNS returned an invalid address family");
  }
  const mappedMatch = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address.address);
  const mappedIpv4 = mappedMatch
    ? [
        Number.parseInt(mappedMatch[1]!, 16) >> 8,
        Number.parseInt(mappedMatch[1]!, 16) & 255,
        Number.parseInt(mappedMatch[2]!, 16) >> 8,
        Number.parseInt(mappedMatch[2]!, 16) & 255,
      ].join(".")
    : /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address.address)?.[1];
  const denied = mappedIpv4
    ? blockedAddresses.check(mappedIpv4, "ipv4")
    : blockedAddresses.check(address.address, address.family === 4 ? "ipv4" : "ipv6");
  if (denied) {
    throw new SafeOutboundError("TARGET_DENIED", "Outbound target resolves to a non-public address");
  }
}

async function resolveAndValidate(url: URL, dependencies: SafeOutboundDependencies): Promise<readonly SafeOutboundAddress[]> {
  const hostname = normalizeHostname(url.hostname);
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new SafeOutboundError("TARGET_DENIED", "Local outbound targets are forbidden");
  }

  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily as 4 | 6 }]
    : await dependencies.resolve(hostname).catch(() => {
        throw new SafeOutboundError("DNS_FAILED", "Outbound target DNS resolution failed");
      });

  if (addresses.length === 0) {
    throw new SafeOutboundError("DNS_FAILED", "Outbound target has no resolved addresses");
  }
  for (const address of addresses) assertAddress(address);
  return addresses;
}

function matchesContentType(actual: string, allowed: readonly string[]): boolean {
  const normalized = actual.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return allowed.some((candidate) => {
    const expected = candidate.trim().toLowerCase();
    return expected.endsWith("/*")
      ? normalized.startsWith(expected.slice(0, -1))
      : normalized === expected;
  });
}

async function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new SafeOutboundError("TIMEOUT", "Outbound request timed out"));
      return;
    }
    const abort = () => {
      reject(new SafeOutboundError("TIMEOUT", "Outbound request timed out"));
    };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function parseUrl(input: string | URL, base?: URL): URL {
  try {
    return new URL(input.toString(), base);
  } catch {
    throw new SafeOutboundError("INVALID_URL", "Outbound URL is invalid");
  }
}

async function openSafeOutbound(
  input: string | URL,
  policy: SafeOutboundPolicy,
  dependencies: SafeOutboundDependencies,
  maximumBytes: number,
): Promise<SafeOutboundStreamResult> {
  if (policy.allowedContentTypes.length === 0) {
    throw new SafeOutboundError("CONTENT_TYPE_DENIED", "At least one outbound content type is required");
  }

  const timeoutMs = boundedInteger(policy.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, "timeoutMs");
  const maxBytes = boundedInteger(policy.maxBytes, DEFAULT_MAX_BYTES, maximumBytes, "maxBytes");
  const maxRedirects = boundedInteger((policy.maxRedirects ?? DEFAULT_MAX_REDIRECTS) + 1, DEFAULT_MAX_REDIRECTS + 1, 11, "maxRedirects") - 1;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: SafeOutboundTransportResponse | undefined;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timeout);
    controller.abort();
    controller.signal.removeEventListener("abort", abortResponse);
  };
  // Enforce the deadline even if a consumer pauses or never starts reading.
  const abortResponse = () => response?.abort();
  controller.signal.addEventListener("abort", abortResponse, { once: true });

  try {
    let currentUrl = parseUrl(input);
    for (let redirectCount = 0; ; redirectCount += 1) {
      assertProtocol(currentUrl, policy);
      await raceAbort(resolveAndValidate(currentUrl, dependencies), controller.signal);
      const connectionAddresses = await raceAbort(resolveAndValidate(currentUrl, dependencies), controller.signal);

      const transport = await raceAbort<SafeOutboundTransportResponse>(dependencies.request({
        url: currentUrl,
        address: connectionAddresses[0]!,
        accept: policy.allowedContentTypes.join(", "),
        signal: controller.signal,
      }).then((received) => {
        if (controller.signal.aborted) {
          received.abort();
          throw new SafeOutboundError("TIMEOUT", "Outbound request timed out");
        }
        return received;
      }), controller.signal);
      response = transport;

      if ([301, 302, 303, 307, 308].includes(transport.status)) {
        transport.abort();
        const location = transport.headers.location;
        if (!location) {
          throw new SafeOutboundError("REDIRECT_DENIED", "Outbound redirect has no Location header");
        }
        if (redirectCount >= maxRedirects) {
          throw new SafeOutboundError("TOO_MANY_REDIRECTS", "Outbound redirect limit exceeded");
        }
        currentUrl = parseUrl(location, currentUrl);
        response = undefined;
        continue;
      }

      if (transport.status < 200 || transport.status >= 300) {
        throw new SafeOutboundError("HTTP_STATUS_DENIED", `Outbound response status ${transport.status} is not accepted`);
      }

      const contentType = transport.headers["content-type"] ?? "";
      if (!matchesContentType(contentType, policy.allowedContentTypes)) {
        throw new SafeOutboundError("CONTENT_TYPE_DENIED", "Outbound response content type is not allowed");
      }

      const contentLength = transport.headers["content-length"];
      if (contentLength !== undefined && (!/^\d+$/.test(contentLength) || !Number.isSafeInteger(Number(contentLength)) || Number(contentLength) > maxBytes)) {
        throw new SafeOutboundError("RESPONSE_TOO_LARGE", "Outbound response exceeds the byte limit");
      }
      const expectedBytes = contentLength === undefined ? null : Number(contentLength);
      let consumed = false;
      const body: AsyncIterable<Uint8Array> = {
        [Symbol.asyncIterator]: async function* () {
          if (consumed) throw new SafeOutboundError("INVALID_URL", "Outbound body is single-use");
          consumed = true;
          const iterator = transport.body[Symbol.asyncIterator]();
          let receivedBytes = 0;
          try {
            while (true) {
              if (controller.signal.aborted) {
                throw new SafeOutboundError("TIMEOUT", "Outbound request timed out or was closed");
              }
              const next = await raceAbort(iterator.next(), controller.signal);
              if (next.done) break;
              receivedBytes += next.value.byteLength;
              if (receivedBytes > maxBytes) {
                throw new SafeOutboundError("RESPONSE_TOO_LARGE", "Outbound response exceeds the byte limit");
              }
              yield next.value;
            }
            if (expectedBytes !== null && receivedBytes !== expectedBytes) {
              throw new SafeOutboundError("RESPONSE_TRUNCATED", "Outbound body length differs from its declaration");
            }
          } finally {
            close();
            controller.signal.removeEventListener("abort", abortResponse);
            // Do not let a stalled upstream iterator hold cancellation open.
            void iterator.return?.().catch(() => undefined);
          }
        },
      };
      return { status: transport.status, contentType, contentLength: expectedBytes, body, finalUrl: currentUrl, close };
    }
  } catch (error) {
    close();
    controller.signal.removeEventListener("abort", abortResponse);
    throw error;
  }
}

export function executeSafeOutboundStream(
  input: string | URL,
  policy: SafeOutboundPolicy,
  dependencies: SafeOutboundDependencies,
): Promise<SafeOutboundStreamResult> {
  if (policy.purpose !== "feed") {
    return Promise.reject(new SafeOutboundError("PROTOCOL_DENIED", "Streaming intake is reserved for feed policies"));
  }
  return openSafeOutbound(input, policy, dependencies, MAX_STREAM_BYTES);
}

/** Bounded small-file compatibility API; never use it for large feed ingestion. */
export async function executeSafeOutbound(
  input: string | URL,
  policy: SafeOutboundPolicy,
  dependencies: SafeOutboundDependencies,
): Promise<SafeOutboundResult> {
  const stream = await openSafeOutbound(input, policy, dependencies, MAX_RESPONSE_BYTES);
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    for await (const chunk of stream.body) {
      chunks.push(chunk);
      receivedBytes += chunk.byteLength;
    }
    const body = new Uint8Array(receivedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { status: stream.status, contentType: stream.contentType, body, finalUrl: stream.finalUrl };
  } finally {
    stream.close();
  }
}
