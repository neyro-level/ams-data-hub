import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  composeSnapshot,
  signSnapshotManifest,
  SNAPSHOT_DATASET_KINDS,
  verifySnapshotSignatureCandidate,
  type SnapshotAcceptanceState,
  type SnapshotSigner,
  type SnapshotTrustSet,
} from "../src/modules/snapshot-delivery/index.ts";

function ephemeralKey(keyId: string): { signer: SnapshotSigner; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    signer: {
      keyId,
      async sign(payload) {
        return Uint8Array.from(sign(null, payload, privateKey));
      },
    },
    publicKey: publicKey.export({ format: "pem", type: "spki" }).toString(),
  };
}

function composition(keyId: string, publishSequence: number) {
  return composeSnapshot({
    schemaMinor: 0,
    projectId: "project-1",
    publishSequence,
    generatedAt: "2026-10-05T00:00:00.000Z",
    publishedAt: "2026-10-05T00:00:01.000Z",
    catalogRevision: `catalog-${publishSequence}`,
    sourceRevisions: [],
    keyId,
    requiresProjectContact: true,
    datasets: SNAPSHOT_DATASET_KINDS.map((kind) => ({
      kind,
      records: kind === "project/contacts"
        ? [{ key: "project-1", value: { phone: "+70000000000" } }]
        : [],
    })),
  });
}

const lastGood: SnapshotAcceptanceState = { projectId: "project-1", schemaMajor: 1, publishSequence: 1 };

function trustSet(input: {
  current: { keyId: string; publicKey: string };
  next?: { keyId: string; publicKey: string };
  revoked?: string[];
}): SnapshotTrustSet {
  return {
    currentKeyId: input.current.keyId,
    nextKeyId: input.next?.keyId ?? null,
    publicKeys: {
      [input.current.keyId]: input.current.publicKey,
      ...(input.next ? { [input.next.keyId]: input.next.publicKey } : {}),
    },
    revokedKeyIds: input.revoked ?? [],
  };
}

describe("Snapshot Ed25519 trust policy", () => {
  it("accepts the trusted current key and keeps private material behind SecretRef", async () => {
    const current = ephemeralKey("current-key");
    const manifest = await signSnapshotManifest(composition(current.signer.keyId, 2), current.signer);
    const result = verifySnapshotSignatureCandidate({
      manifest,
      trustSet: trustSet({ current: { keyId: current.signer.keyId, publicKey: current.publicKey } }),
      lastGood,
    });
    expect(result).toEqual({ accepted: true, nextState: { ...lastGood, publishSequence: 2 } });
    const adapter = readFileSync("src/modules/snapshot-delivery/infrastructure/ed25519-secret-ref-signer.ts", "utf8");
    expect(adapter).toContain('import "server-only"');
    expect(adapter).toContain("resolveSecretRef");
    expect(adapter).not.toContain("process.env");
  });

  it("accepts the trusted next key during the overlap window", async () => {
    const current = ephemeralKey("current-key");
    const next = ephemeralKey("next-key");
    const manifest = await signSnapshotManifest(composition(next.signer.keyId, 2), next.signer);
    expect(verifySnapshotSignatureCandidate({
      manifest,
      trustSet: trustSet({
        current: { keyId: current.signer.keyId, publicKey: current.publicKey },
        next: { keyId: next.signer.keyId, publicKey: next.publicKey },
      }),
      lastGood,
    }).accepted).toBe(true);
  });

  it("rejects an unknown keyId and leaves last-good untouched", async () => {
    const current = ephemeralKey("current-key");
    const unknown = ephemeralKey("unknown-key");
    const manifest = await signSnapshotManifest(composition(unknown.signer.keyId, 2), unknown.signer);
    expect(verifySnapshotSignatureCandidate({
      manifest,
      trustSet: trustSet({ current: { keyId: current.signer.keyId, publicKey: current.publicKey } }),
      lastGood,
    })).toEqual({ accepted: false, reason: "UNKNOWN_KEY_ID", nextState: lastGood });
  });

  it("rejects a revoked keyId despite a valid signature and leaves last-good untouched", async () => {
    const compromised = ephemeralKey("compromised-key");
    const manifest = await signSnapshotManifest(composition(compromised.signer.keyId, 2), compromised.signer);
    expect(verifySnapshotSignatureCandidate({
      manifest,
      trustSet: trustSet({
        current: { keyId: compromised.signer.keyId, publicKey: compromised.publicKey },
        revoked: [compromised.signer.keyId],
      }),
      lastGood,
    })).toEqual({ accepted: false, reason: "REVOKED_KEY_ID", nextState: lastGood });
  });

  it("accepts rotation to the next key only with a higher publishSequence", async () => {
    const current = ephemeralKey("current-key");
    const next = ephemeralKey("next-key");
    const overlapTrust = trustSet({
      current: { keyId: current.signer.keyId, publicKey: current.publicKey },
      next: { keyId: next.signer.keyId, publicKey: next.publicKey },
    });
    const stale = await signSnapshotManifest(composition(next.signer.keyId, 1), next.signer);
    expect(verifySnapshotSignatureCandidate({ manifest: stale, trustSet: overlapTrust, lastGood }))
      .toEqual({ accepted: false, reason: "STALE_PUBLISH_SEQUENCE", nextState: lastGood });
    const rotated = await signSnapshotManifest(composition(next.signer.keyId, 2), next.signer);
    expect(verifySnapshotSignatureCandidate({ manifest: rotated, trustSet: overlapTrust, lastGood }).accepted).toBe(true);
  });

  it("accepts an emergency republish from a safe key with a higher publishSequence", async () => {
    const safe = ephemeralKey("emergency-safe-key");
    const manifest = await signSnapshotManifest(composition(safe.signer.keyId, 10), safe.signer);
    expect(verifySnapshotSignatureCandidate({
      manifest,
      trustSet: trustSet({ current: { keyId: safe.signer.keyId, publicKey: safe.publicKey } }),
      lastGood: { ...lastGood, publishSequence: 9 },
    })).toEqual({ accepted: true, nextState: { ...lastGood, publishSequence: 10 } });
  });
});
