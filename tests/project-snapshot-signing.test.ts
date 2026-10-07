import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createProjectSnapshotSigningResolver } from "../src/modules/snapshot-delivery/infrastructure/project-snapshot-signing.ts";
import { createSnapshotBuildCapability } from "../src/infrastructure/snapshot-build-capability.ts";
const scope = { organizationId: "synthetic-org", projectId: "synthetic-project" };
const pem = generateKeyPairSync("ed25519").publicKey.export({ format: "pem", type: "spki" }).toString();
const binding = () => ({ ...scope, keyId: "current", privateKeyRef: "SYNTHETIC_PRIVATE_KEY", currentKeyId: "current", nextKeyId: null,
  revokedKeyIds: [] as string[], publicKeyRefs: { current: "SYNTHETIC_PUBLIC_KEY" } });
function environment(rows: unknown = [binding()]) {
  return { PROJECT_SNAPSHOT_SIGNING_BINDINGS: JSON.stringify(rows), SYNTHETIC_PUBLIC_KEY: pem };
}
describe("exact project snapshot signing bindings", () => {
  it("never propagates private PEM from a misbound public-key reference", () => {
    const pair = generateKeyPairSync("ed25519");
    const privatePem = pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const result = createProjectSnapshotSigningResolver({ ...environment(), SYNTHETIC_PUBLIC_KEY: privatePem })(scope);
    expect(result.trustSet.publicKeys.current).toBe(pair.publicKey.export({ format: "pem", type: "spki" }).toString());
    expect(JSON.stringify(result)).not.toContain("PRIVATE KEY");
    expect(JSON.stringify(result)).not.toContain(privatePem);
  });
  it("resolves only public keys and a private SecretRef, and isolates returned trust sets", () => {
    const resolve = createProjectSnapshotSigningResolver(environment()); const first = resolve(scope);
    expect(first.keyId).toBe("current"); expect(first.privateKeyRef.name).toBe("SYNTHETIC_PRIVATE_KEY");
    expect(first.trustSet.publicKeys.current).toBe(pem);
    expect(Reflect.set(first.trustSet.publicKeys, "current", "caller mutation")).toBe(true);
    expect(Reflect.set(first.trustSet.revokedKeyIds, "0", "current")).toBe(true);
    expect(resolve(scope).trustSet.publicKeys.current).toBe(pem); expect(resolve(scope).trustSet.revokedKeyIds).toEqual([]);
    expect(JSON.stringify(first.privateKeyRef)).toBe('"[SECRET_REF]"');
  });
  it.each(["missing", "malformed", "duplicate", "revoked", "untrusted", "unknown-ref"])("rejects %s registry without exposing raw input", (mode) => {
    const row = binding(); if (mode === "revoked") row.revokedKeyIds = ["current"];
    if (mode === "untrusted") row.keyId = "other";
    const env = environment(mode === "duplicate" ? [row, row] : [row]);
    if (mode === "missing") env.PROJECT_SNAPSHOT_SIGNING_BINDINGS = "";
    if (mode === "malformed") env.PROJECT_SNAPSHOT_SIGNING_BINDINGS = "synthetic-private-invalid-json";
    if (mode === "unknown-ref") env.PROJECT_SNAPSHOT_SIGNING_BINDINGS = JSON.stringify([{ ...row, privateKeyRef: "synthetic-private-value" }]);
    expect(() => createProjectSnapshotSigningResolver(env)).toThrow("PROJECT_SNAPSHOT_SIGNING_BINDINGS_INVALID");
  });
  it("denies unbound projects and invalid public key material with finite errors", () => {
    const resolve = createProjectSnapshotSigningResolver(environment());
    expect(() => resolve({ ...scope, projectId: "foreign-project" })).toThrow("PROJECT_SNAPSHOT_SIGNING_BINDING_REQUIRED");
    expect(() => createProjectSnapshotSigningResolver({ ...environment(), SYNTHETIC_PUBLIC_KEY: "synthetic-invalid-pem" })(scope))
      .toThrow("PROJECT_SNAPSHOT_SIGNING_CONFIGURATION_INVALID");
  });
  it.each(["__proto__", "prototype", "constructor"])("rejects reserved key ID %s instead of inherited trust", (key) => {
    const row = { ...binding(), keyId: key, currentKeyId: key, publicKeyRefs: Object.fromEntries([[key, "SYNTHETIC_PUBLIC_KEY"]]) };
    expect(() => createProjectSnapshotSigningResolver(environment([row]))).toThrow("PROJECT_SNAPSHOT_SIGNING_BINDINGS_INVALID");
  });
  it("keeps disabled worker capability independent of signing config or storage and validates explicit enable", () => {
    const storage = vi.fn();
    expect(createSnapshotBuildCapability(storage, {})).toBeNull();
    expect(createSnapshotBuildCapability(storage, { SNAPSHOT_BUILD_ENABLED: "false", PROJECT_SNAPSHOT_SIGNING_BINDINGS: "invalid" })).toBeNull();
    expect(storage).not.toHaveBeenCalled();
    expect(() => createSnapshotBuildCapability(storage, { SNAPSHOT_BUILD_ENABLED: "1" })).toThrow("SNAPSHOT_BUILD_CAPABILITY_INVALID");
    expect(() => createSnapshotBuildCapability(storage, { SNAPSHOT_BUILD_ENABLED: "true" })).toThrow("PROJECT_SNAPSHOT_SIGNING_BINDINGS_INVALID");
  });
  it("enabled capability parses a registry but defers credentials/key reads until after durable replay", () => {
    const env = { ...environment(), SNAPSHOT_BUILD_ENABLED: "true" };
    Object.defineProperty(env, "SYNTHETIC_PUBLIC_KEY", { get: () => { throw new Error("SYNTHETIC_EAGER_KEY_READ"); } });
    const storage = vi.fn(); expect(createSnapshotBuildCapability(storage, env)).toBeTypeOf("function"); expect(storage).not.toHaveBeenCalled();
  });
});
