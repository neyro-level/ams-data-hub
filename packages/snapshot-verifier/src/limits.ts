export interface SnapshotVerifierLimits {
  maxCompressedFileBytes: number;
  maxDecompressedFileBytes: number;
  maxDatasetRecords: number;
  maxTotalSnapshotBytes: number;
}

export const DEFAULT_SNAPSHOT_VERIFIER_LIMITS: Readonly<SnapshotVerifierLimits> = Object.freeze({
  maxCompressedFileBytes: 4 * 1024 * 1024,
  maxDecompressedFileBytes: 16 * 1024 * 1024,
  maxDatasetRecords: 50_000,
  maxTotalSnapshotBytes: 64 * 1024 * 1024,
});

export const MAX_SNAPSHOT_VERIFIER_LIMITS: Readonly<SnapshotVerifierLimits> = Object.freeze({
  maxCompressedFileBytes: 16 * 1024 * 1024,
  maxDecompressedFileBytes: 64 * 1024 * 1024,
  maxDatasetRecords: 250_000,
  maxTotalSnapshotBytes: 256 * 1024 * 1024,
});

/** Explicit trusted overrides may raise defaults, never the hard ceilings. */
export function resolveSnapshotVerifierLimits(policy: Partial<SnapshotVerifierLimits> = {}): Readonly<SnapshotVerifierLimits> {
  const limits = { ...DEFAULT_SNAPSHOT_VERIFIER_LIMITS };
  for (const key of Object.keys(limits) as Array<keyof SnapshotVerifierLimits>) {
    const value = policy[key];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_SNAPSHOT_VERIFIER_LIMITS[key]) {
      throw new Error("SNAPSHOT_VERIFIER_LIMIT_INVALID");
    }
    limits[key] = value;
  }
  return Object.freeze(limits);
}
