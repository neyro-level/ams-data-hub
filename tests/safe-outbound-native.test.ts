import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ lookup: vi.fn(), https: vi.fn(), http: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: transport.lookup }));
vi.mock("node:https", () => ({ request: transport.https }));
vi.mock("node:http", () => ({ request: transport.http }));
import { safeOutboundStream } from "../src/platform/http/safe-outbound.ts";

it("native HTTPS transport pins the second validated IP while preserving TLS and Host identity", async () => {
  transport.lookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]).mockResolvedValueOnce([{ address: "1.1.1.1", family: 4 }]);
  const message = Object.assign(Readable.from([new Uint8Array([1, 2])]), { statusCode: 200, headers: { "content-type": "application/xml", "content-length": "2" } });
  const request = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() });
  transport.https.mockImplementation((_options, receive) => { request.end.mockImplementation(() => receive(message)); return request; });
  const result = await safeOutboundStream("https://feed.example.test:8443/private?fixture=1", { purpose: "feed", allowedContentTypes: ["application/xml"], maxBytes: 16 });
  let received = 0;
  for await (const chunk of result.body) received += chunk.byteLength;
  expect(received).toBe(2);
  expect(transport.lookup).toHaveBeenCalledTimes(2);
  expect(transport.https).toHaveBeenCalledWith(expect.objectContaining({ hostname: "1.1.1.1", family: 4, servername: "feed.example.test", port: 8443, path: "/private?fixture=1", headers: expect.objectContaining({ host: "feed.example.test:8443", accept: "application/xml" }) }), expect.any(Function));
  expect(transport.http).not.toHaveBeenCalled();
  expect(request.destroy).toHaveBeenCalled();
});
