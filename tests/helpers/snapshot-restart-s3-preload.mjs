import { createHash } from "node:crypto";
import { appendFile, readFile, readdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";

// Child-only lower SDK transport. Next routes, authorization, manifest/signature
// validation and ACK transactions remain the current standalone implementation.
const directory = process.env.SYNTHETIC_RESTART_OBJECT_DIRECTORY;
const bucket = process.env.SYNTHETIC_RESTART_BUCKET;
if (!directory || !basename(directory).startsWith("ams-shutdown-proof-") || !bucket?.startsWith("synthetic-shutdown-"))
  throw new Error("SYNTHETIC_RESTART_STORAGE_SCOPE_INVALID");
if (!(await stat(directory)).isDirectory()) throw new Error("SYNTHETIC_RESTART_STORAGE_DIRECTORY_INVALID");
const require = createRequire(import.meta.url);
// Patch the exact external SDK instance resolved by the standalone, not the
// root checkout's separate package instance. No HTTP request may escape it.
const aliasesDirectory = resolve(".next/standalone/.next/node_modules/@aws-sdk");
const aliases = (await readdir(aliasesDirectory)).filter((name) => /^client-s3-[a-f0-9]+$/u.test(name));
if (aliases.length !== 1) throw new Error("SYNTHETIC_RESTART_SDK_ALIAS_AMBIGUOUS");
const sdk = require(join(aliasesDirectory, aliases[0]));
sdk.S3Client.prototype.send = async (command, options) => {
  options?.abortSignal?.throwIfAborted();
  if (!(command instanceof sdk.GetObjectCommand) && !(command instanceof sdk.HeadObjectCommand))
    throw new Error("SYNTHETIC_RESTART_UNEXPECTED_SDK_OPERATION");
  if (command.input.Bucket !== bucket || typeof command.input.Key !== "string")
    throw new Error("SYNTHETIC_RESTART_OBJECT_SCOPE_INVALID");
  const name = `${createHash("sha256").update(command.input.Key).digest("hex")}.bin`;
  const body = await readFile(join(directory, name));
  options?.abortSignal?.throwIfAborted();
  await appendFile(join(directory, "snapshot-restart-sdk-events.jsonl"), `${JSON.stringify({ pid: process.pid,
    operation: command instanceof sdk.GetObjectCommand ? "GET" : "HEAD", keyHash: name.slice(0, -4) })}\n`);
  return { ContentLength: body.length, ContentType: "application/octet-stream", LastModified: new Date(0), ETag: "synthetic",
    ...(command instanceof sdk.GetObjectCommand ? { Body: { destroy() {}, async *[Symbol.asyncIterator]() { yield body; } } } : {}) };
};
