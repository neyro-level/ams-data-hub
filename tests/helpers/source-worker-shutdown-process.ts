import dns from "node:dns/promises";
import https from "node:https";
import http from "node:http";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { Readable } from "node:stream";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// Child-only transport fixture. Application, queue, guard, Prisma and lifecycle
// are the real implementations; no provider/network request can escape.
const mode = process.env.SYNTHETIC_SHUTDOWN_MODE;
const bytes = Buffer.from('<realty-feed xmlns="http://webmaster.yandex.ru/schemas/feed/realty/2010-06"><offer internal-id="one"><category>квартира</category><type>продажа</type><price><value>2000</value></price></offer></realty-feed>');
const notify = (event: string) => { if (process.connected) process.send?.({ event }); };
let releaseUpload: (() => void) | undefined;
process.on("message", (message) => {
  if (message === "emit-sigterm") process.emit("SIGTERM");
  if (message === "release-upload") releaseUpload?.();
});
// Disconnect IPC on shutdown so the helper itself cannot keep a drained worker alive.
process.once("SIGTERM", () => { if (process.connected) process.disconnect(); });
process.once("SIGINT", () => { if (process.connected) process.disconnect(); });
dns.lookup = (async (hostname: string) => {
  if (hostname !== "synthetic-shutdown.example.invalid") throw new Error("SYNTHETIC_DNS_DENIED");
  return [{ address: "93.184.216.34", family: 4 }];
}) as unknown as typeof dns.lookup;
const request = ((options: https.RequestOptions, callback: (response: http.IncomingMessage) => void) => {
  if (options.servername !== "synthetic-shutdown.example.invalid") throw new Error("SYNTHETIC_HTTP_DENIED");
  let closed = false;
  const req = Object.assign(new EventEmitter(), {
    end() {
      notify("headers-requested");
      if (mode === "headers") return;
      queueMicrotask(() => {
        if (closed) return;
        const response = Object.assign(Readable.from([bytes]), { statusCode: 200,
          headers: { "content-type": "application/xml", "content-length": String(bytes.length) } });
        callback(response as unknown as http.IncomingMessage);
      });
    },
    destroy(error?: Error) {
      if (!closed) { closed = true; if (error) req.emit("error", error); req.emit("close"); }
      return req;
    },
  });
  return req;
}) as typeof https.request;
https.request = request;
http.request = (() => { throw new Error("SYNTHETIC_HTTP_PROTOCOL_DENIED"); }) as typeof http.request;
syncBuiltinESMExports();
S3Client.prototype.send = (async (command: unknown, options?: { abortSignal?: AbortSignal }) => {
  if (!(command instanceof PutObjectCommand)) throw new Error("SYNTHETIC_S3_DENIED");
  for await (const chunk of command.input.Body as AsyncIterable<Uint8Array>) {
    if (!chunk.byteLength) throw new Error("SYNTHETIC_EMPTY_UPLOAD");
  }
  notify("upload-consumed");
  if (mode === "fatal") return new Promise(() => undefined); // Deliberately broken SDK ignores cancellation.
  if (mode === "upload") {
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(new Error("SYNTHETIC_UPLOAD_ABORTED"));
      options?.abortSignal?.addEventListener("abort", abort, { once: true });
      if (options?.abortSignal?.aborted) abort();
      releaseUpload = () => { options?.abortSignal?.removeEventListener("abort", abort); resolve(); };
    });
  }
  return { ETag: "synthetic-shutdown" };
}) as typeof S3Client.prototype.send;
process.argv = [process.execPath, "src/worker/main.ts", mode === "healthcheck" ? "source-healthcheck" : "source-worker"];
await import("../../src/worker/main.ts");
if (mode === "healthcheck" && process.connected) process.disconnect();
