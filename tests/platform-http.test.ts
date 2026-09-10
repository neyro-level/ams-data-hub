import { describe, expect, it } from "vitest";
import { createPublicErrorEnvelope } from "../src/platform/http/error-envelope.ts";
import { liveHealthSchema, readyHealthSchema } from "../src/platform/http/health.ts";

const correlationId = "00000000-0000-4000-8000-000000000020";

describe("platform HTTP contracts", () => {
  it("creates a stable safe error envelope", () => {
    expect(
      createPublicErrorEnvelope({
        code: "AUTH_UNAVAILABLE",
        message: "Сервис временно недоступен.",
        correlationId,
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "AUTH_UNAVAILABLE",
        message: "Сервис временно недоступен.",
        fieldErrors: {},
        correlationId,
      },
    });
  });

  it("rejects unstable error codes and invalid correlation IDs", () => {
    expect(() =>
      createPublicErrorEnvelope({
        code: "bad-code",
        message: "Unsafe",
        correlationId,
      }),
    ).toThrow();
    expect(() =>
      createPublicErrorEnvelope({
        code: "VALID_CODE",
        message: "Unsafe",
        correlationId: "request-1",
      }),
    ).toThrow();
  });

  it("validates live and ready release-aware health DTOs", () => {
    expect(
      liveHealthSchema.parse({
        status: "ok",
        service: "ams-seo-monitor",
        releaseSha: null,
        correlationId,
        time: "2026-09-03T00:00:00.000Z",
      }),
    ).toMatchObject({ status: "ok", releaseSha: null });
    expect(
      readyHealthSchema.parse({
        status: "ready",
        service: "ams-seo-monitor",
        releaseSha: "a".repeat(40),
        correlationId,
        dependencies: {
          postgresql: "ready",
          auth: "configured",
          outbox: { status: "healthy", pending: 0, processing: 0, deadLetter: 0 },
          worker: { status: "healthy", lastHeartbeatAt: "2026-09-03T00:00:00.000Z" },
          integrationFreshness: {
            status: "fresh",
            latestSyncFinishedAt: "2026-09-03T00:00:00.000Z",
            latestSyncStatus: "success",
          },
        },
      }),
    ).toMatchObject({ releaseSha: "a".repeat(40) });
  });
});
