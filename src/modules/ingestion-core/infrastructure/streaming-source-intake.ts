import "server-only";

import { safeOutboundStream, type SafeOutboundPolicy, type SafeOutboundStreamResult } from "../../../platform/http/safe-outbound.ts";
import type { SecretRef, SecretValue } from "../../../platform/security/secret-ref.ts";
import type { StreamingObjectStorage } from "../../../platform/storage/object-storage.ts";
import type { SourceImportTarget } from "../application/import-pipeline.ts";
import type { SourceAdapterDescriptor } from "../domain/adapter-profile-registry.ts";
import type { SourceSafetyPolicy } from "../domain/safety-engine.ts";
import { resolveSourceIntakeLimits } from "../domain/source-intake-policy.ts";
import { StreamingRawArtifact } from "./streaming-raw-artifact.ts";
import { createSourceEndpointResolver } from "./source-endpoint-resolver.ts";

export function createStreamingSourceIntake(input: {
  storage: StreamingObjectStorage;
  adapter: SourceAdapterDescriptor;
  safetyPolicy: Partial<Pick<SourceSafetyPolicy, "maxRawArtifactBytes" | "maxRecordCount">>;
  fetchFeed?: (endpoint: string | URL, policy: SafeOutboundPolicy) => Promise<SafeOutboundStreamResult>;
  signal?: AbortSignal;
} & ({ endpoint: SecretValue; endpointReference?: never } | { endpointReference: SecretRef; endpoint?: never })) {
  const limits = resolveSourceIntakeLimits(input.adapter.intakeLimits, input.safetyPolicy);
  return {
    limits,
    safeIntake: {
      async acquire() {
        const policy: SafeOutboundPolicy = {
          purpose: "feed", allowedContentTypes: ["application/xml", "text/xml", "application/octet-stream"],
          timeoutMs: limits.timeoutMs, maxBytes: limits.maxRawArtifactBytes,
          ...(input.signal ? { signal: input.signal } : {}),
        };
        // Reference-owned production path deliberately cannot inject fetchFeed.
        const response = input.endpointReference
          ? await createSourceEndpointResolver(input.endpointReference).acquire(policy)
          : await (input.fetchFeed ?? safeOutboundStream)(input.endpoint, policy);
        return new StreamingRawArtifact(response, input.storage, limits.maxRawArtifactBytes);
      },
    },
    rawArtifactStore: {
      put: async (_target: SourceImportTarget, raw: StreamingRawArtifact) => raw.persist(),
      release: async (_target: SourceImportTarget, raw: StreamingRawArtifact) => raw.dispose(),
    },
    yrlParserLimits: {
      maxArtifactBytes: limits.maxRawArtifactBytes, maxOffers: limits.maxRecords, maxDepth: limits.maxDepth,
      maxElementsPerOffer: limits.maxElementsPerRecord, maxAttributesPerElement: limits.maxAttributesPerElement,
      maxFieldCharacters: limits.maxFieldCharacters, maxOfferCharacters: limits.maxRecordCharacters,
    },
    marketplaceParserLimits: {
      maxArtifactBytes: limits.maxRawArtifactBytes, maxRecords: limits.maxRecords, maxDepth: limits.maxDepth,
      maxElementsPerRecord: limits.maxElementsPerRecord, maxAttributesPerElement: limits.maxAttributesPerElement,
      maxFieldCharacters: limits.maxFieldCharacters, maxRecordCharacters: limits.maxRecordCharacters,
    },
  };
}
