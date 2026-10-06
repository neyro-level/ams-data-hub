import "server-only";

import { safeOutboundStream, SafeOutboundError, type SafeOutboundPolicy, type SafeOutboundStreamResult } from "../../../platform/http/safe-outbound.ts";
import { resolveSecretRef, type SecretRef } from "../../../platform/security/secret-ref.ts";

export type SourceFeedResponse = Omit<SafeOutboundStreamResult, "finalUrl">;
const outboundCodes = new Set([
  "INVALID_URL", "PROTOCOL_DENIED", "TARGET_DENIED", "DNS_FAILED", "REDIRECT_DENIED", "TOO_MANY_REDIRECTS",
  "TIMEOUT", "RESPONSE_TOO_LARGE", "RESPONSE_TRUNCATED", "CONTENT_TYPE_DENIED", "HTTP_STATUS_DENIED",
]);

function intakeFailure(error: unknown): Error {
  return new Error(error instanceof SafeOutboundError && outboundCodes.has(error.code)
    ? `SOURCE_ENDPOINT_${error.code}` : "SOURCE_ENDPOINT_INTAKE_FAILED");
}

/** Resolve only while acquiring server-side intake. No endpoint value is a
 * property, parameter of a job, JSON result or returned final-URL metadata. */
export function createSourceEndpointResolver(reference: SecretRef) {
  return Object.freeze({
    toJSON: () => "[SOURCE_ENDPOINT_RESOLVER]",
    async acquire(policy: SafeOutboundPolicy): Promise<SourceFeedResponse> {
      if (policy.purpose !== "feed") throw new Error("SOURCE_ENDPOINT_PURPOSE_INVALID");
      let endpoint: ReturnType<typeof resolveSecretRef>;
      try { endpoint = resolveSecretRef(reference); } catch { throw new Error("SOURCE_ENDPOINT_CREDENTIAL_UNAVAILABLE"); }
      let response: SafeOutboundStreamResult;
      try { response = await safeOutboundStream(endpoint, policy); } catch (error) { throw intakeFailure(error); }
      const close = () => { try { response.close(); } catch { /* close observers never expose a transport cause */ } };
      return {
        status: response.status, contentType: response.contentType, contentLength: response.contentLength,
        body: {
          async *[Symbol.asyncIterator]() {
            try { yield* response.body; } catch (error) { throw intakeFailure(error); }
            finally { close(); }
          },
        },
        close,
      };
    },
  });
}
