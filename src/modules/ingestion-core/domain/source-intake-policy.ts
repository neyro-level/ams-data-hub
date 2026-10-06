import type { SourceSafetyPolicy } from "./safety-engine.ts";

export interface SourceIntakeLimits {
  maxRawArtifactBytes: number;
  maxRecords: number;
  maxDepth: number;
  maxElementsPerRecord: number;
  maxAttributesPerElement: number;
  maxFieldCharacters: number;
  maxRecordCharacters: number;
  timeoutMs: number;
}

export const MAX_SOURCE_INTAKE_LIMITS: Readonly<SourceIntakeLimits> = Object.freeze({
  maxRawArtifactBytes: 256 * 1024 * 1024,
  maxRecords: 100_000,
  maxDepth: 32,
  maxElementsPerRecord: 512,
  maxAttributesPerElement: 64,
  maxFieldCharacters: 256_000,
  maxRecordCharacters: 1_000_000,
  timeoutMs: 60_000,
});

type SourceRawSafety = Partial<Pick<SourceSafetyPolicy, "maxRawArtifactBytes" | "maxRecordCount">>;

/** Adapter/source policy can narrow the hard ceiling, never expand it. */
export function resolveSourceIntakeLimits(adapter: Partial<SourceIntakeLimits> = {}, source: SourceRawSafety = {}): Readonly<SourceIntakeLimits> {
  const limits = { ...MAX_SOURCE_INTAKE_LIMITS };
  for (const key of Object.keys(limits) as Array<keyof SourceIntakeLimits>) {
    const requested = adapter[key];
    if (requested === undefined) continue;
    if (!Number.isSafeInteger(requested) || requested <= 0) throw new Error("SOURCE_INTAKE_LIMIT_INVALID");
    limits[key] = Math.min(limits[key], requested);
  }
  for (const [key, requested] of [
    ["maxRawArtifactBytes", source.maxRawArtifactBytes],
    ["maxRecords", source.maxRecordCount],
  ] as const) {
    if (requested === undefined || requested === null) continue;
    if (!Number.isSafeInteger(requested) || requested <= 0) throw new Error("SOURCE_INTAKE_LIMIT_INVALID");
    limits[key] = Math.min(limits[key], requested);
  }
  return Object.freeze(limits);
}
