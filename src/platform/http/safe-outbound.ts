import "server-only";

import { lookup } from "node:dns/promises";
import { request as requestHttp } from "node:http";
import { request as requestHttps } from "node:https";
import { isIP } from "node:net";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";

import {
  executeSafeOutbound,
  executeSafeOutboundStream,
  SafeOutboundError,
  type SafeOutboundDependencies,
  type SafeOutboundPolicy,
  type SafeOutboundResult,
  type SafeOutboundStreamResult,
  type SafeOutboundTransportResponse,
} from "./safe-outbound-core.ts";

export { SafeOutboundError } from "./safe-outbound-core.ts";
export type { SafeOutboundPolicy, SafeOutboundResult, SafeOutboundStreamResult } from "./safe-outbound-core.ts";

function firstHeader(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function toTransportResponse(message: IncomingMessage): SafeOutboundTransportResponse {
  return {
    status: message.statusCode ?? 0,
    headers: {
      location: firstHeader(message.headers, "location"),
      "content-type": firstHeader(message.headers, "content-type"),
      "content-length": firstHeader(message.headers, "content-length"),
    },
    body: message,
    abort: () => message.destroy(),
  };
}

const dependencies: SafeOutboundDependencies = {
  async resolve(hostname) {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses.map(({ address, family }) => ({
      address,
      family: family as 4 | 6,
    }));
  },
  request(input) {
    return new Promise((resolve, reject) => {
      const request = input.url.protocol === "https:" ? requestHttps : requestHttp;
      const hostname = input.url.hostname.replace(/^\[|\]$/g, "");
      const port = input.url.port
        ? Number(input.url.port)
        : input.url.protocol === "https:" ? 443 : 80;
      const req = request({
        protocol: input.url.protocol,
        hostname: input.address.address,
        family: input.address.family,
        port,
        path: `${input.url.pathname}${input.url.search}`,
        method: "GET",
        servername: isIP(hostname) === 0 ? hostname : undefined,
        headers: {
          host: input.url.host,
          accept: input.accept,
          "user-agent": "AMS-Data-Hub-Safe-Outbound/1.0",
          connection: "close",
        },
      }, (message) => resolve(toTransportResponse(message)));

      const abort = () => req.destroy(new SafeOutboundError("TIMEOUT", "Outbound request timed out"));
      input.signal.addEventListener("abort", abort, { once: true });
      req.once("error", reject);
      req.once("close", () => input.signal.removeEventListener("abort", abort));
      req.end();
    });
  },
};

/**
 * The only application-owned HTTP path for remote feeds and media. DNS is
 * validated twice and the connection is pinned to the second safe address so
 * a later resolver lookup cannot redirect the socket to a private network.
 */
export function safeOutboundBuffered(
  input: string | URL,
  policy: SafeOutboundPolicy,
): Promise<SafeOutboundResult> {
  return executeSafeOutbound(input, policy, dependencies);
}

export function safeOutboundStream(
  input: string | URL,
  policy: SafeOutboundPolicy,
): Promise<SafeOutboundStreamResult> {
  return executeSafeOutboundStream(input, policy, dependencies);
}

/** @deprecated Use explicit buffered or streaming mode. */
export const safeOutboundRequest = safeOutboundBuffered;
