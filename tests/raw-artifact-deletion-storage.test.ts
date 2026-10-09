import { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { S3RawArtifactDeletionStorage } from "../src/platform/storage/timeweb-s3-object-storage.ts";
import { createProjectRawArtifactDeletionResolver } from "../src/platform/storage/project-object-storage.ts";

const sha = "a".repeat(64);
function fixture(status: number, body = "", maxAttempts = 1) {
  const handle = vi.fn(async (request: { method: string; path: string }) => {
    expect(request.method).toBe("DELETE"); expect(request.path).toBe(`/synthetic-delete/source-artifacts/${sha}`);
    return { response: { statusCode: status, headers: { "content-type": "application/xml" }, body: Buffer.from(body) } };
  });
  const client = new S3Client({ endpoint: "https://synthetic.invalid", region: "ru-1", forcePathStyle: true,
    credentials: { accessKeyId: "synthetic-delete", secretAccessKey: "synthetic-delete" }, maxAttempts,
    requestHandler: { handle } });
  return { storage: new S3RawArtifactDeletionStorage({ bucket: "synthetic-delete", client }), handle };
}

describe("narrow destructive S3 capability with actual SDK middleware", () => {
  it("deletes only the exact current raw SHA key, never snapshots or versions", async () => {
    const { storage, handle } = fixture(204);
    try {
      await expect(storage.deleteRawArtifact({ rawArtifactHash: sha, signal: new AbortController().signal })).resolves.toBeUndefined();
      expect(handle).toHaveBeenCalledOnce();
      await expect(storage.deleteRawArtifact({ rawArtifactHash: `../snapshots/${sha}`, signal: new AbortController().signal })).rejects.toThrow();
      expect(handle).toHaveBeenCalledOnce();
    } finally { storage.close(); }
  });
  it.each([503, 429])("does not retry a retryable SDK HTTP %s response", async (status) => {
    const { storage, handle } = fixture(status, "<Error><Code>SlowDown</Code></Error>");
    try {
      await expect(storage.deleteRawArtifact({ rawArtifactHash: sha, signal: new AbortController().signal })).rejects.toThrow(/^RAW_DELETE_IO_UNKNOWN$/);
      expect(handle).toHaveBeenCalledOnce();
    } finally { storage.close(); }
  });
  it.each([{ code: "NoSuchKey", accepted: true }, { code: "NoSuchBucket", accepted: false }, { code: "NotFound", accepted: false }])(
    "distinguishes definitive $code from an ambiguous/misbound 404", async ({ code, accepted }) => {
      const { storage, handle } = fixture(404, `<Error><Code>${code}</Code></Error>`);
      try {
        const operation = storage.deleteRawArtifact({ rawArtifactHash: sha, signal: new AbortController().signal });
        if (accepted) await expect(operation).resolves.toBeUndefined(); else await expect(operation).rejects.toThrow(/^RAW_DELETE_IO_UNKNOWN$/);
        expect(handle).toHaveBeenCalledOnce();
      } finally { storage.close(); }
    });
  it("refuses a retry-configured client or aborted request before external IO", async () => {
    const configured = fixture(204, "", 3); const cancelled = fixture(204);
    try {
      await expect(configured.storage.deleteRawArtifact({ rawArtifactHash: sha, signal: new AbortController().signal }))
        .rejects.toThrow(/^RAW_DELETE_RETRY_CONFIGURATION_INVALID$/);
      await expect(cancelled.storage.deleteRawArtifact({ rawArtifactHash: sha, signal: AbortSignal.abort() })).rejects.toThrow(/^RAW_DELETE_IO_UNKNOWN$/);
      expect(configured.handle).not.toHaveBeenCalled(); expect(cancelled.handle).not.toHaveBeenCalled();
    } finally { configured.storage.close(); cancelled.storage.close(); }
  });
  it("reuses the exact-project registry without global fallback or a general delete(key) port", () => {
    const binding = { organizationId: "org", projectId: "project", bucketRef: "DELETE_BUCKET", endpointRef: "DELETE_ENDPOINT",
      regionRef: "DELETE_REGION", accessKeyIdRef: "DELETE_ACCESS", secretAccessKeyRef: "DELETE_SECRET" };
    const resolve = createProjectRawArtifactDeletionResolver({ PROJECT_STORAGE_BINDINGS: JSON.stringify([binding]),
      DELETE_BUCKET: "synthetic-delete", DELETE_ENDPOINT: "https://synthetic.invalid", DELETE_REGION: "ru-1",
      DELETE_ACCESS: "synthetic-delete", DELETE_SECRET: "synthetic-delete" });
    const storage = resolve({ organizationId: "org", projectId: "project" });
    try {
      expect(resolve({ organizationId: "org", projectId: "project" })).toBe(storage);
      expect(storage).not.toHaveProperty("delete"); expect(storage).not.toHaveProperty("get"); expect(storage).not.toHaveProperty("put");
      expect(() => resolve({ organizationId: "other", projectId: "project" })).toThrow(/^PROJECT_STORAGE_BINDING_REQUIRED$/);
      expect(() => createProjectRawArtifactDeletionResolver({})).toThrow(/^PROJECT_STORAGE_BINDINGS_INVALID$/);
    } finally { storage.close(); }
  });
});
