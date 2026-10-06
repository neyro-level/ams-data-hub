import { describe, expect, it, vi } from "vitest";
import { createProjectObjectStorageResolver } from "../src/platform/storage/project-object-storage.ts";
import { createTimewebS3ObjectStorage } from "../src/platform/storage/timeweb-s3-object-storage.ts";

const binding = { organizationId: "org", projectId: "a", bucketRef: "S3_BUCKET", endpointRef: "S3_ENDPOINT",
  regionRef: "S3_REGION", accessKeyIdRef: "AWS_ACCESS_KEY_ID", secretAccessKeyRef: "AWS_SECRET_ACCESS_KEY" };
const values = { S3_BUCKET: "synthetic-a", S3_ENDPOINT: "https://s3.twcstorage.ru", S3_REGION: "ru-1",
  AWS_ACCESS_KEY_ID: "synthetic-a", AWS_SECRET_ACCESS_KEY: "synthetic-a" };
function env(bindings: unknown = [binding]) { return { ...values, PROJECT_STORAGE_BINDINGS: JSON.stringify(bindings) }; }

describe("explicit project object storage bindings", () => {
  it("reuses existing references only for the exact scope and caches its adapter", () => {
    const create = vi.fn(createTimewebS3ObjectStorage); const resolve = createProjectObjectStorageResolver(env(), create);
    const storage = resolve({ organizationId: "org", projectId: "a" });
    expect(storage.getBounded).toBeTypeOf("function"); expect(storage.putStream).toBeTypeOf("function");
    expect(resolve({ organizationId: "org", projectId: "a" })).toBe(storage); expect(create).toHaveBeenCalledOnce();
    expect(() => resolve({ organizationId: "org", projectId: "b" })).toThrow(/^PROJECT_STORAGE_BINDING_REQUIRED$/);
    expect(() => resolve({ organizationId: "other", projectId: "a" })).toThrow(/^PROJECT_STORAGE_BINDING_REQUIRED$/);
    expect(create).toHaveBeenCalledOnce();
  });
  it("never treats legacy global S3 variables as a fleet binding", () => {
    const create = vi.fn(createTimewebS3ObjectStorage);
    expect(() => createProjectObjectStorageResolver(values, create)).toThrow(/^PROJECT_STORAGE_BINDINGS_INVALID$/);
    expect(create).not.toHaveBeenCalled();
  });
  it.each([[], [binding, binding], [{ ...binding, secret: "synthetic" }], [{ ...binding, bucketRef: "not-a-ref" }],
    [binding, { ...binding, projectId: "b" }]].map((bindings) => [bindings]))("rejects malformed or duplicate reference registry %j", (bindings) => {
    expect(() => createProjectObjectStorageResolver(env(bindings))).toThrow(/^PROJECT_STORAGE_BINDINGS_INVALID$/);
  });
  it("redacts missing secret references and invalid endpoint errors", () => {
    const resolve = createProjectObjectStorageResolver({ ...env(), AWS_SECRET_ACCESS_KEY: undefined });
    expect(() => resolve({ organizationId: "org", projectId: "a" })).toThrow(/^PROJECT_STORAGE_CONFIGURATION_INVALID$/);
    const unsafe = createProjectObjectStorageResolver({ ...env(), S3_ENDPOINT: "http://private.invalid?synthetic=secret" });
    expect(() => unsafe({ organizationId: "org", projectId: "a" })).toThrow(/^PROJECT_STORAGE_CONFIGURATION_INVALID$/);
  });
  it.each(["bucket", "credential", "bucket-whitespace", "credential-whitespace"])("rejects aliased shared %s between distinct scopes", (shared) => {
    const second = { ...binding, projectId: "b", bucketRef: "BUCKET_B", accessKeyIdRef: "ACCESS_B", secretAccessKeyRef: "SECRET_B" };
    const resolve = createProjectObjectStorageResolver({ ...env([binding, second]),
      BUCKET_B: shared === "bucket-whitespace" ? ` ${values.S3_BUCKET} ` : shared === "bucket" ? values.S3_BUCKET : "synthetic-b",
      ACCESS_B: shared === "credential-whitespace" ? ` ${values.AWS_ACCESS_KEY_ID} ` : shared === "credential" ? values.AWS_ACCESS_KEY_ID : "synthetic-b",
      SECRET_B: "synthetic-b" });
    resolve({ organizationId: "org", projectId: "a" });
    expect(() => resolve({ organizationId: "org", projectId: "b" })).toThrow(/^PROJECT_STORAGE_CONFIGURATION_INVALID$/);
  });
});
