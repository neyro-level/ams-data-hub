import { describe, expect, it } from "vitest";
import { createReleaseManifest, validateConnectionBudget } from "../scripts/release-contract.mjs";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const images = {
  web: { tag: "ams-data-hub-web:sha", digest: digest("a") },
  worker: { tag: "ams-data-hub-worker:sha", digest: digest("b") },
  migrator: { tag: "ams-data-hub-migrator:sha", digest: digest("c") },
};

describe("release artifact contract", () => {
  it("requires explicit rollback metadata after the first release", () => {
    expect(() => createReleaseManifest({ commitSha: "1".repeat(40), createdAt: "2026-01-01T00:00:00.000Z", dependencyLockSha256: "d".repeat(64), images })).toThrow(/previous release/i);
  });

  it("records exact current and previous image identities", () => {
    const manifest = createReleaseManifest({
      commitSha: "1".repeat(40),
      createdAt: "2026-01-01T00:00:00.000Z",
      dependencyLockSha256: "d".repeat(64),
      images,
      previous: { commitSha: "2".repeat(40), images },
    });
    expect(manifest.rollback.mode).toBe("previous-release");
    expect((manifest.images as typeof images).worker.digest).toBe(digest("b"));
    expect(manifest.deploymentStrategy).toBe("sourcecraft-registry-digest-pull-and-compose-up");
  });

  it("allows an explicitly declared first release without invented rollback identity", () => {
    const manifest = createReleaseManifest({
      commitSha: "1".repeat(40),
      createdAt: "2026-01-01T00:00:00.000Z",
      dependencyLockSha256: "d".repeat(64),
      images,
      firstRelease: true,
    });
    expect(manifest.rollback).toEqual({ mode: "first-release", previousCommitSha: null, images: null });
  });

  it("fails closed when the connection allocation exceeds the provider limit", () => {
    expect(() => validateConnectionBudget({ databaseMaxConnections: 10, reservedConnections: 2, allocations: { web: { instances: 2, maxPerInstance: 5 } } })).toThrow(/exceeded/i);
  });
});
