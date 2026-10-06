import "server-only";

import { createHash } from "node:crypto";
import { createReadStream, type ReadStream } from "node:fs";
import { chmod, mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { SafeOutboundStreamResult } from "../../../platform/http/safe-outbound.ts";
import { createSourceArtifactKey, MAX_STREAMING_OBJECT_BYTES, type StreamingObjectStorage } from "../../../platform/storage/object-storage.ts";
import type { RawArtifactReceipt } from "../application/import-pipeline.ts";

/** One attempt-owned private disk lease; no path/endpoint is a persisted DTO. */
export class StreamingRawArtifact {
  private readonly spoolRoot = resolve(tmpdir());
  private readonly uploadController = new AbortController();
  private readonly readers = new Set<ReadStream>();
  private directory: string | undefined;
  private file: string | undefined;
  private receipt: RawArtifactReceipt | undefined;
  private state: "NEW" | "WRITING" | "STORED" | "FAILED" | "DISPOSED" = "NEW";
  private persistence: Promise<RawArtifactReceipt> | undefined;

  constructor(
    private readonly response: SafeOutboundStreamResult,
    private readonly storage: StreamingObjectStorage,
    private readonly maxBytes: number,
  ) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_STREAMING_OBJECT_BYTES) {
      response.close();
      throw new Error("RAW_ARTIFACT_LIMIT_INVALID");
    }
  }

  persist(): Promise<RawArtifactReceipt> {
    if (this.state === "STORED") return Promise.resolve(this.receipt!);
    if (this.state !== "NEW") return Promise.reject(new Error("RAW_ARTIFACT_STATE_INVALID"));
    this.state = "WRITING";
    this.persistence = this.persistOnce();
    return this.persistence;
  }

  private async persistOnce(): Promise<RawArtifactReceipt> {
    try {
      this.directory = await mkdtemp(join(this.spoolRoot, "ams-data-hub-raw-"));
      await chmod(this.directory, 0o700);
      this.file = join(this.directory, "artifact.raw");
      const file = await open(this.file, "wx", 0o600);
      const hash = createHash("sha256");
      let bytes = 0;
      try {
        for await (const chunk of this.response.body) {
          bytes += chunk.byteLength;
          if (bytes > this.maxBytes) throw new Error("RAW_ARTIFACT_TOO_LARGE");
          hash.update(chunk);
          let offset = 0;
          while (offset < chunk.byteLength) {
            const written = await file.write(chunk, offset, chunk.byteLength - offset, null);
            if (written.bytesWritten === 0) throw new Error("RAW_ARTIFACT_WRITE_FAILED");
            offset += written.bytesWritten;
          }
        }
      } finally {
        await file.close();
        this.response.close();
      }
      if (this.response.contentLength !== null && bytes !== this.response.contentLength) {
        throw new Error("RAW_ARTIFACT_TRUNCATED");
      }
      const rawArtifactHash = hash.digest("hex");
      const storageKey = createSourceArtifactKey(rawArtifactHash);
      const stored = await this.storage.putStream({ key: storageKey, contentType: this.response.contentType, contentLength: bytes, sha256: rawArtifactHash, openBody: () => this.openReader(), signal: this.uploadController.signal });
      if (stored.key !== storageKey || stored.sha256 !== rawArtifactHash || stored.contentLength !== bytes) {
        throw new Error("RAW_ARTIFACT_STORAGE_RECEIPT_INVALID");
      }
      this.receipt = { storageKey, rawArtifactHash, byteCount: bytes };
      this.state = "STORED";
      return this.receipt;
    } catch (error) {
      this.state = "FAILED";
      this.response.close();
      await this.removeLease().catch(() => undefined);
      throw error;
    }
  }

  open(): AsyncIterable<Uint8Array> {
    if (this.state !== "STORED") throw new Error("RAW_ARTIFACT_NOT_STORED");
    return this.openReader();
  }

  private openReader(): AsyncIterable<Uint8Array> {
    if (!this.file || this.state === "DISPOSED") throw new Error("RAW_ARTIFACT_NOT_AVAILABLE");
    const reader = createReadStream(this.file, { highWaterMark: 64 * 1024 });
    this.readers.add(reader);
    reader.once("close", () => this.readers.delete(reader));
    return reader;
  }

  async dispose(): Promise<void> {
    this.response.close();
    this.uploadController.abort();
    await this.persistence?.catch(() => undefined);
    try { await this.removeLease(); } finally { this.state = "DISPOSED"; }
  }

  private async removeLease(): Promise<void> {
    await Promise.all([...this.readers].map(async (reader) => {
      if (reader.closed) return;
      // Iterator cancellation may emit AbortError before close. That is not a
      // filesystem-cleanup failure; wait for the descriptor to close anyway.
      const closed = new Promise<void>((done) => reader.once("close", () => done()));
      reader.destroy();
      await closed;
    }));
    if (!this.directory) return;
    const directory = resolve(this.directory);
    // Delete only this mkdtemp-owned immediate child, never a caller path.
    if (dirname(directory) !== this.spoolRoot || !basename(directory).startsWith("ams-data-hub-raw-")) {
      throw new Error("RAW_ARTIFACT_CLEANUP_SCOPE_INVALID");
    }
    await rm(directory, { recursive: true, force: true });
    this.directory = undefined;
    this.file = undefined;
  }
}
