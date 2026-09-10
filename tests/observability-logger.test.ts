import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "../src/platform/observability/logger.ts";

function captureLogger() {
  let output = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  return {
    logger: createLogger({ scope: "test" }, stream),
    read() {
      return output.trim();
    },
  };
}

describe("pino observability logger", () => {
  it("removes nested PII and secrets from the serialized log", () => {
    const { logger, read } = captureLogger();
    logger.info({
      password: "secret-value",
      authorization: "Bearer token",
      headers: {
        cookie: "sid=1",
        authorization: "Bearer inner",
        "x-api-key": "header-secret",
      },
      user: {
        id: "user-safe-id",
        email: "nested-user@example.test",
        phone: "+70000000001",
      },
      actor: { id: "actor-safe-id", email: "actor@example.test", token: "actor-token" },
      payload: {
        apiKey: "top-secret",
        email: "lead@example.test",
        phone: "+70000000002",
        headers: { authorization: "Bearer payload", cookie: "payload-cookie" },
        user: { email: "payload-user@example.test", password: "payload-password" },
        actor: { phone: "+70000000003", secret: "payload-actor-secret" },
        projectSlug: "alpha",
      },
    }, "structured-test");

    const serialized = read();
    const payload = JSON.parse(serialized) as Record<string, unknown>;
    for (const forbidden of [
      "secret-value",
      "Bearer token",
      "sid=1",
      "Bearer inner",
      "header-secret",
      "nested-user@example.test",
      "+70000000001",
      "backup-secret",
      "actor@example.test",
      "actor-token",
      "top-secret",
      "lead@example.test",
      "+70000000002",
      "Bearer payload",
      "payload-cookie",
      "payload-user@example.test",
      "payload-password",
      "+70000000003",
      "payload-actor-secret",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(payload.password).toBe("[REDACTED]");
    expect(payload.authorization).toBe("[REDACTED]");
    expect(payload.headers).toMatchObject({
      cookie: "[REDACTED]",
      authorization: "[REDACTED]",
    });
    expect(payload.payload).toMatchObject({
      apiKey: "[REDACTED]",
      projectSlug: "alpha",
    });
  });
});
