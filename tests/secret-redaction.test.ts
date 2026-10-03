import type { DestinationStream } from "pino";
import { describe, expect, it } from "vitest";

import { createLogger } from "../src/platform/observability/logger.ts";
import {
  createSecretRefStatus,
  defineSecretRef,
  resolveSecretRef,
} from "../src/platform/security/secret-ref.ts";
import {
  REDACTED_URL,
  redactFeedUrlForUi,
} from "../src/platform/security/sensitive-redaction.ts";

function captureDestination(lines: string[]): DestinationStream {
  return {
    write(chunk: string | Uint8Array) {
      lines.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      return true;
    },
  };
}

describe("SecretRef", () => {
  it("stores only an environment reference and resolves on the server", () => {
    const reference = defineSecretRef("SYNTHETIC_PROVIDER_TOKEN");
    const serialized = JSON.stringify(reference);
    const value = resolveSecretRef(reference, {
      SYNTHETIC_PROVIDER_TOKEN: "synthetic-secret-value-for-redaction-test",
    });

    expect(serialized).toBe('"[SECRET_REF]"');
    expect(reference.toString()).toBe("[SECRET_REF]");
    expect(value).toBe("synthetic-secret-value-for-redaction-test");
  });

  it("creates a UI-safe status without the name or value", () => {
    const reference = defineSecretRef("SYNTHETIC_PROVIDER_TOKEN");
    const status = createSecretRefStatus(reference, {
      SYNTHETIC_PROVIDER_TOKEN: "synthetic-secret-value-for-redaction-test",
    });
    const serialized = JSON.stringify(status);

    expect(status).toEqual({ configured: true, displayValue: "[REDACTED]" });
    expect(serialized).not.toContain("SYNTHETIC_PROVIDER_TOKEN");
    expect(serialized).not.toContain("synthetic-secret-value-for-redaction-test");
  });

  it("redacts a feed URL completely for UI presentation", () => {
    const feedUrl = "https://feed-user:feed-password@feeds.example.test/private.xml?token=synthetic-token";
    expect(redactFeedUrlForUi(feedUrl)).toBe(REDACTED_URL);
  });
});

describe("structured logging redaction", () => {
  it("never emits resolved secret values or feed URLs", () => {
    const reference = defineSecretRef("SYNTHETIC_PROVIDER_TOKEN");
    const secret = resolveSecretRef(reference, {
      SYNTHETIC_PROVIDER_TOKEN: "synthetic-secret-value-for-redaction-test",
    });
    const feedUrl = "https://feed-user:feed-password@feeds.example.test/private.xml?token=synthetic-token";
    const lines: string[] = [];
    const logger = createLogger(undefined, captureDestination(lines));

    logger.info({
      arbitraryField: secret,
      nested: {
        feedUrl,
        secretRef: reference,
      },
    }, `Fetching ${feedUrl} with ${secret}`);

    const output = lines.join("");
    expect(output).toContain("[REDACTED]");
    expect(output).toContain("[REDACTED_URL]");
    expect(output).not.toContain("synthetic-secret-value-for-redaction-test");
    expect(output).not.toContain("feeds.example.test");
    expect(output).not.toContain("feed-password");
    expect(output).not.toContain("synthetic-token");
  });
});
