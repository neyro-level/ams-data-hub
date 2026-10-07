import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ inspect: vi.fn(), trigger: vi.fn(), capture: vi.fn(), publish: vi.fn(), factory: vi.fn() }));
vi.mock("../src/modules/ingestion-core/server.ts", () => ({ assertSnapshotSourceGoodTrigger: calls.trigger }));
vi.mock("../src/modules/snapshot-delivery/infrastructure/snapshot-publication-replay.ts", () => ({ inspectSnapshotPublicationServer: calls.inspect }));
vi.mock("../src/modules/snapshot-delivery/infrastructure/snapshot-input-capture-command.ts", () => ({ captureSnapshotInput: calls.capture }));
vi.mock("../src/modules/snapshot-delivery/infrastructure/snapshot-publication.ts", () => ({ createSnapshotPublicationServer: calls.factory }));
import { createSnapshotBuildRequestHandler } from "../src/modules/snapshot-delivery/infrastructure/snapshot-build-request-handler.ts";
import type { ClaimedReliabilityEvent } from "../src/modules/platform-operations/application/ports/reliability-repository.ts";
import { defineSecretRef } from "../src/platform/security/secret-ref.ts";
import { snapshotInputRequestHashes } from "../src/modules/snapshot-delivery/application/snapshot-build-input.ts";

const scope = { organizationId: "synthetic-org", projectId: "synthetic-project" };
function event(): ClaimedReliabilityEvent {
  return { outboxEventId: "synthetic-outbox", jobRunId: "synthetic-run", workerId: "synthetic-worker",
    leaseAcquiredAt: new Date(0).toISOString(), organizationId: scope.organizationId, topic: "snapshot.build.request",
    payload: { schemaVersion: 1, ...scope, sourceId: "synthetic-source", sourceRevisionId: "synthetic-good", sourceRevisionSequence: 1 },
    attempt: 1, correlationId: randomUUID(), schemaVersion: 1, occurredAt: new Date(0).toISOString() };
}
function dependencies() {
  return { resolvePublication: vi.fn(async () => ({ ...scope, keyId: "synthetic-key",
    privateKeyRef: defineSecretRef("SYNTHETIC_SIGNING_KEY"), trustSet: { currentKeyId: "synthetic-key", nextKeyId: null,
      revokedKeyIds: [], publicKeys: {} }, storage: { head: vi.fn(), put: vi.fn(), get: vi.fn(), presignGet: vi.fn() } })) };
}
beforeEach(() => {
  vi.clearAllMocks(); calls.inspect.mockReset().mockResolvedValue({ receipt: null, run: null });
  calls.trigger.mockReset().mockResolvedValue(undefined);
  calls.capture.mockReset().mockResolvedValue({}); calls.publish.mockReset().mockResolvedValue({});
  calls.factory.mockReset().mockReturnValue(calls.publish);
});
describe("exact snapshot outbox request executor", () => {
  it.each(["topic", "schema", "organization", "payload", "identity"])("rejects invalid %s before any database or config reads", async (mode) => {
    const input = event(); if (mode === "topic") input.topic = "operations-control.snapshot.build.request";
    if (mode === "schema") input.schemaVersion = 2; if (mode === "organization") input.organizationId = "foreign-org";
    if (mode === "payload") input.payload.privateData = "synthetic-private"; if (mode === "identity") input.outboxEventId = "../foreign";
    const deps = dependencies();
    await expect(createSnapshotBuildRequestHandler(deps)(input)).rejects.toMatchObject({ code: "SNAPSHOT_BUILD_REQUEST_INVALID", retryable: false });
    expect(calls.inspect).not.toHaveBeenCalled(); expect(deps.resolvePublication).not.toHaveBeenCalled(); expect(calls.capture).not.toHaveBeenCalled();
  });
  it("uses stable server-owned capture identity across attempts and binds exact scoped principal", async () => {
    const input = event(); const deps = dependencies(); const handle = createSnapshotBuildRequestHandler(deps);
    await handle(input); await handle({ ...input, attempt: 4, leaseAcquiredAt: new Date(1000).toISOString(), jobRunId: "other-run" });
    const [principal, request] = calls.capture.mock.calls[0]!;
    expect(principal).toMatchObject({ kind: "project-job", ...scope, jobName: "snapshot-input" });
    expect(request).toEqual({ ...scope, schemaMinor: 0, idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}$/u) });
    expect(calls.capture.mock.calls[1]![1]).toEqual(request);
    expect(calls.publish.mock.calls[0]![1]).toEqual(snapshotInputRequestHashes(request));
    expect(deps.resolvePublication).toHaveBeenCalledWith(scope);
    expect(calls.inspect.mock.invocationCallOrder[0]).toBeLessThan(deps.resolvePublication.mock.invocationCallOrder[0]!);
    expect(calls.trigger).toHaveBeenCalledWith(principal, input.payload);
    expect(calls.trigger.mock.invocationCallOrder[0]).toBeLessThan(deps.resolvePublication.mock.invocationCallOrder[0]!);
    expect(deps.resolvePublication.mock.invocationCallOrder[0]).toBeLessThan(calls.capture.mock.invocationCallOrder[0]!);
  });
  it("does not fresh-capture an existing receipt or resolve config for a committed run", async () => {
    calls.inspect.mockResolvedValueOnce({ receipt: { id: "existing" }, run: null }); const deps = dependencies();
    await createSnapshotBuildRequestHandler(deps)(event()); expect(calls.capture).not.toHaveBeenCalled(); expect(calls.publish).toHaveBeenCalledOnce();
    deps.resolvePublication.mockClear(); calls.publish.mockClear(); calls.trigger.mockClear(); calls.inspect.mockResolvedValue({ receipt: { id: "existing" }, run: { deliveryRunId: "committed" } });
    await createSnapshotBuildRequestHandler(deps)(event()); expect(deps.resolvePublication).not.toHaveBeenCalled(); expect(calls.publish).not.toHaveBeenCalled();
    expect(calls.trigger).not.toHaveBeenCalled();
  });
  it("rejects nonexistent or non-GOOD triggers before config/capture", async () => {
    calls.trigger.mockRejectedValue(new Error("SNAPSHOT_BUILD_REQUEST_INVALID")); const deps = dependencies();
    await expect(createSnapshotBuildRequestHandler(deps)(event())).rejects.toMatchObject({ code: "SNAPSHOT_BUILD_REQUEST_INVALID", retryable: false });
    expect(deps.resolvePublication).not.toHaveBeenCalled(); expect(calls.capture).not.toHaveBeenCalled(); expect(calls.publish).not.toHaveBeenCalled();
  });
  it("returns concurrent durable success despite config failure without propagating private errors", async () => {
    const deps = dependencies(); deps.resolvePublication.mockRejectedValue(new Error("https://private.invalid/synthetic-credential"));
    calls.inspect.mockResolvedValueOnce({ receipt: null, run: null }).mockResolvedValueOnce({ receipt: { id: "existing" }, run: { deliveryRunId: "committed" } });
    await expect(createSnapshotBuildRequestHandler(deps)(event())).resolves.toBeUndefined(); expect(calls.capture).not.toHaveBeenCalled();
    calls.inspect.mockResolvedValue({ receipt: null, run: null });
    await expect(createSnapshotBuildRequestHandler(deps)(event())).rejects.toMatchObject({ message: "SNAPSHOT_BUILD_UNAVAILABLE", retryable: true });
  });
  it("uses finite terminal codes for stale facts and rejects wrong scoped config", async () => {
    calls.publish.mockRejectedValue(new Error("SNAPSHOT_PUBLICATION_MEDIA_STALE"));
    await expect(createSnapshotBuildRequestHandler(dependencies())(event())).rejects.toMatchObject({ code: "SNAPSHOT_BUILD_REJECTED", retryable: false });
    const deps = dependencies(); const bound = await deps.resolvePublication(); deps.resolvePublication.mockResolvedValue({ ...bound, projectId: "foreign-project" });
    calls.capture.mockClear(); await expect(createSnapshotBuildRequestHandler(deps)(event())).rejects.toMatchObject({ code: "SNAPSHOT_BUILD_REQUEST_INVALID", retryable: false });
    expect(calls.capture).not.toHaveBeenCalled();
  });
  it("does not publish after cancellation during capture and never admits initially aborted work", async () => {
    const controller = new AbortController(); calls.capture.mockImplementation(async () => { controller.abort(); return {}; });
    await expect(createSnapshotBuildRequestHandler(dependencies())(event(), controller.signal)).rejects.toMatchObject({ code: "SNAPSHOT_BUILD_CANCELLED", retryable: true });
    expect(calls.publish).not.toHaveBeenCalled(); calls.inspect.mockClear();
    await expect(createSnapshotBuildRequestHandler(dependencies())(event(), controller.signal)).rejects.toMatchObject({ code: "SNAPSHOT_BUILD_CANCELLED" });
    expect(calls.inspect).not.toHaveBeenCalled();
  });
});
