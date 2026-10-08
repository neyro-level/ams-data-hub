import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createProjectSnapshotTrustResolver } from "../src/modules/snapshot-delivery/infrastructure/project-snapshot-trust.ts";
import { createOperationalSnapshotPublishCapability, createOperationalSnapshotRollbackCapability } from "../src/infrastructure/snapshot-build-capability.ts";

const scope = { organizationId: "synthetic-org", projectId: "synthetic-project" };
const pair = generateKeyPairSync("ed25519");
const pem = pair.publicKey.export({ format: "pem", type: "spki" }).toString();
const row = () => ({ ...scope, currentKeyId: "current", nextKeyId: null, revokedKeyIds: [] as string[], publicKeyRefs: { current: "SYNTHETIC_PUBLIC_KEY" } });
const environment = (rows: unknown = [row()]) => ({ PROJECT_SNAPSHOT_SIGNING_BINDINGS: JSON.stringify(rows), SYNTHETIC_PUBLIC_KEY: pem });

describe("selected publication public-only project trust", () => {
  it("rollback is independently disabled and validates existing refs without reading secrets at startup", () => {
    const storage = vi.fn();
    expect(createOperationalSnapshotRollbackCapability(storage, {})).toBeNull();
    expect(createOperationalSnapshotRollbackCapability(storage, { SNAPSHOT_ROLLBACK_ENABLED: "false", PROJECT_SNAPSHOT_SIGNING_BINDINGS: "invalid" })).toBeNull();
    expect(() => createOperationalSnapshotRollbackCapability(storage, { SNAPSHOT_ROLLBACK_ENABLED: "1" })).toThrow("SNAPSHOT_ROLLBACK_CAPABILITY_INVALID");
    expect(() => createOperationalSnapshotRollbackCapability(storage, { SNAPSHOT_ROLLBACK_ENABLED: "true" })).toThrow("PROJECT_SNAPSHOT_SIGNING_BINDINGS_INVALID");
    const env = { ...environment([{ ...row(), keyId: "current", privateKeyRef: "SYNTHETIC_PRIVATE_KEY" }]),
      SNAPSHOT_ROLLBACK_ENABLED: "true", SNAPSHOT_BUILD_ENABLED: "false", SNAPSHOT_PUBLISH_ENABLED: "false" };
    Object.defineProperty(env, "SYNTHETIC_PRIVATE_KEY", { get() { throw new Error("SYNTHETIC_PRIVATE_READ"); } });
    expect(createOperationalSnapshotRollbackCapability(storage, env)).toBeTypeOf("function");
    expect(storage).not.toHaveBeenCalled();
  });
  it("accepts public-only or existing signing rows without requiring/resolving private refs", () => {
    for (const binding of [row(), { ...row(), keyId: "current", privateKeyRef: "SYNTHETIC_PRIVATE_KEY" }]) {
      const env = environment([binding]);
      Object.defineProperty(env, "SYNTHETIC_PRIVATE_KEY", { get() { throw new Error("SYNTHETIC_PRIVATE_READ"); } });
      expect(createProjectSnapshotTrustResolver(env)(scope)).toEqual({ currentKeyId: "current", nextKeyId: null,
        revokedKeyIds: [], publicKeys: { current: pem } });
    }
  });
  it("validates registry eagerly but public material only lazily", () => {
    const env = environment();
    Object.defineProperty(env, "SYNTHETIC_PUBLIC_KEY", { get() { throw new Error("SYNTHETIC_EAGER_PUBLIC_READ"); } });
    const resolve = createProjectSnapshotTrustResolver(env);
    expect(() => resolve(scope)).toThrow("PROJECT_SNAPSHOT_TRUST_CONFIGURATION_INVALID");
    expect(createOperationalSnapshotPublishCapability(vi.fn(), Object.assign(env, { SNAPSHOT_PUBLISH_ENABLED: "true" }))).toBeTypeOf("function");
  });
  it("freshly resolves policy/key rotation and isolates returned maps/arrays", () => {
    const env = environment(); const resolve = createProjectSnapshotTrustResolver(env); const initial = resolve(scope);
    expect(Reflect.set(initial.publicKeys, "current", "caller mutation")).toBe(true);
    expect(Reflect.set(initial.revokedKeyIds, "0", "current")).toBe(true);
    expect(resolve(scope).publicKeys.current).toBe(pem); expect(resolve(scope).revokedKeyIds).toEqual([]);
    env.PROJECT_SNAPSHOT_SIGNING_BINDINGS = JSON.stringify([{ ...row(), revokedKeyIds: ["current"] }]);
    expect(resolve(scope).revokedKeyIds).toEqual(["current"]);
    env.PROJECT_SNAPSHOT_SIGNING_BINDINGS = "invalid";
    expect(() => resolve(scope)).toThrow("PROJECT_SNAPSHOT_TRUST_BINDINGS_INVALID");
  });
  it.each(["missing", "malformed", "duplicate", "current-ref", "next-ref", "reserved", "wildcard"])("rejects %s registry", (mode) => {
    const binding = row(); let rows: unknown = [binding];
    if (mode === "duplicate") rows = [binding, binding];
    if (mode === "current-ref") rows = [{ ...binding, currentKeyId: "other" }];
    if (mode === "next-ref") rows = [{ ...binding, nextKeyId: "other" }];
    if (mode === "reserved") rows = [{ ...binding, currentKeyId: "__proto__", publicKeyRefs: { __proto__: "SYNTHETIC_PUBLIC_KEY" } }];
    if (mode === "wildcard") rows = [{ ...binding, projectId: "*" }];
    const env = environment(rows);
    if (mode === "missing") env.PROJECT_SNAPSHOT_SIGNING_BINDINGS = "";
    if (mode === "malformed") env.PROJECT_SNAPSHOT_SIGNING_BINDINGS = "private-invalid-json";
    expect(() => createProjectSnapshotTrustResolver(env)).toThrow("PROJECT_SNAPSHOT_TRUST_BINDINGS_INVALID");
  });
  it("rejects foreign scope and nonpublic/non-Ed25519 material with finite errors", () => {
    const resolve = createProjectSnapshotTrustResolver(environment());
    expect(() => resolve({ ...scope, projectId: "foreign" })).toThrow("PROJECT_SNAPSHOT_TRUST_BINDING_REQUIRED");
    for (const material of ["invalid", pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ format: "pem", type: "spki" }).toString()]) {
      expect(() => createProjectSnapshotTrustResolver({ ...environment(), SYNTHETIC_PUBLIC_KEY: material })(scope))
        .toThrow("PROJECT_SNAPSHOT_TRUST_CONFIGURATION_INVALID");
    }
  });
  it("disabled capability ignores registry/storage; enable is explicit and no BUILD required", () => {
    const storage = vi.fn();
    expect(createOperationalSnapshotPublishCapability(storage, {})).toBeNull();
    expect(createOperationalSnapshotPublishCapability(storage, { SNAPSHOT_PUBLISH_ENABLED: "false", PROJECT_SNAPSHOT_SIGNING_BINDINGS: "invalid" })).toBeNull();
    expect(() => createOperationalSnapshotPublishCapability(storage, { SNAPSHOT_PUBLISH_ENABLED: "1" })).toThrow("SNAPSHOT_PUBLISH_CAPABILITY_INVALID");
    expect(() => createOperationalSnapshotPublishCapability(storage, { SNAPSHOT_PUBLISH_ENABLED: "true" })).toThrow("PROJECT_SNAPSHOT_TRUST_BINDINGS_INVALID");
    expect(createOperationalSnapshotPublishCapability(storage, { ...environment(), SNAPSHOT_PUBLISH_ENABLED: "true", SNAPSHOT_BUILD_ENABLED: "false" })).toBeTypeOf("function");
    expect(storage).not.toHaveBeenCalled();
  });
});
