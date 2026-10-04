import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ProjectSnapshotStorage,
  assertImmutableObjectStoragePut,
  type ObjectStorage,
  type ObjectStorageGetResult,
  type ObjectStorageObject,
  type ObjectStoragePresignGetInput,
  type ObjectStoragePresignedUrl,
  type ObjectStoragePutInput,
} from "../src/platform/storage/object-storage.ts";
import {
  SNAPSHOT_DATASET_KINDS,
  assertDeliveryTransition,
  composeSnapshot,
  createSnapshotDeliveryService,
  signSnapshotManifest,
  type CurrentSnapshotManifest,
  type DeliveryRun,
  type DeliveryRunStatus,
  type SnapshotDeliveryRepository,
  type SnapshotSigner,
  type SnapshotWebhookNotifier,
  type TransitionDeliveryRunInput,
} from "../src/modules/snapshot-delivery/index.ts";

class MemoryObjectStorage implements ObjectStorage {
  readonly entries = new Map<string, ObjectStorageGetResult>();
  putCount = 0;

  async put(input: ObjectStoragePutInput): Promise<ObjectStorageObject> {
    this.putCount += 1;
    assertImmutableObjectStoragePut(input);
    const result: ObjectStorageGetResult = {
      ...input,
      body: Uint8Array.from(input.body),
      contentLength: input.body.byteLength,
      etag: null,
      lastModifiedAt: new Date("2026-10-05T00:00:00.000Z"),
    };
    this.entries.set(input.key, result);
    return result;
  }
  async get(key: string) { return this.entries.get(key) ?? null; }
  async head(key: string) { return this.entries.get(key) ?? null; }
  async presignGet(input: ObjectStoragePresignGetInput): Promise<ObjectStoragePresignedUrl> {
    return { url: new URL(`https://storage.example.test/${input.key}`), expiresAt: new Date() };
  }
}

class MemoryDeliveryRepository implements SnapshotDeliveryRepository {
  current: CurrentSnapshotManifest | null = null;
  runs: DeliveryRun[] = [];

  async publishCurrentAndCreateRun(input: CurrentSnapshotManifest): Promise<DeliveryRun> {
    if (this.current && input.publishSequence <= this.current.publishSequence) throw new Error("SNAPSHOT_DELIVERY_SEQUENCE_STALE");
    this.current = input;
    const run: DeliveryRun = {
      ...input,
      deliveryRunId: `delivery-${input.publishSequence}`,
      status: "PENDING",
      notifiedAt: null,
      downloadedAt: null,
      appliedAt: null,
      acknowledgedAt: null,
      failedAt: null,
      staleAt: null,
      safeErrorCode: null,
      createdAt: new Date(input.publishedAt),
      updatedAt: new Date(input.publishedAt),
    };
    this.runs.push(run);
    return run;
  }
  async getCurrentManifest(organizationId: string, projectId: string) {
    return this.current?.organizationId === organizationId && this.current.projectId === projectId ? this.current : null;
  }
  async getRun(organizationId: string, projectId: string, publishSequence: number) {
    return this.runs.find((run) => run.organizationId === organizationId && run.projectId === projectId && run.publishSequence === publishSequence) ?? null;
  }
  async transitionRun(input: TransitionDeliveryRunInput): Promise<DeliveryRun> {
    const run = await this.getRun(input.organizationId, input.projectId, input.publishSequence);
    if (!run || !input.expectedStatuses.includes(run.status)) throw new Error("DELIVERY_TRANSITION_CONFLICT");
    assertDeliveryTransition(run.status, input.nextStatus);
    run.status = input.nextStatus;
    run.updatedAt = input.occurredAt;
    run.safeErrorCode = input.safeErrorCode ?? run.safeErrorCode;
    const field: Partial<Record<DeliveryRunStatus, keyof DeliveryRun>> = {
      NOTIFIED: "notifiedAt", DOWNLOADED: "downloadedAt", APPLIED: "appliedAt",
      ACKNOWLEDGED: "acknowledgedAt", FAILED: "failedAt", STALE: "staleAt",
    };
    const timestampField = field[input.nextStatus];
    if (timestampField) (run as unknown as Record<string, unknown>)[timestampField] = input.occurredAt;
    return run;
  }
  async markStaleBefore(cutoff: Date, occurredAt: Date): Promise<number> {
    let count = 0;
    for (const run of this.runs) {
      if (["PENDING", "NOTIFIED", "DOWNLOADED", "APPLIED"].includes(run.status) && run.createdAt <= cutoff) {
        assertDeliveryTransition(run.status, "STALE");
        run.status = "STALE";
        run.staleAt = occurredAt;
        count += 1;
      }
    }
    return count;
  }
}

function signer(): SnapshotSigner {
  const { privateKey } = generateKeyPairSync("ed25519");
  return { keyId: "delivery-key", async sign(payload) { return Uint8Array.from(sign(null, payload, privateKey)); } };
}

async function fixture(publishSequence = 1) {
  const snapshotSigner = signer();
  const composition = composeSnapshot({
    schemaMinor: 0,
    projectId: "project-1",
    publishSequence,
    generatedAt: "2026-10-05T00:00:00.000Z",
    publishedAt: "2026-10-05T00:00:01.000Z",
    catalogRevision: `catalog-${publishSequence}`,
    sourceRevisions: [],
    keyId: snapshotSigner.keyId,
    requiresProjectContact: true,
    datasets: SNAPSHOT_DATASET_KINDS.map((kind) => ({
      kind,
      records: kind === "project/contacts" ? [{ key: "project-1", value: { phone: "+70000000000" } }] : [],
    })),
  });
  return { composition, manifest: await signSnapshotManifest(composition, snapshotSigner) };
}

describe("snapshot delivery", () => {
  it("uploads immutable project artifacts, advances current manifest, and sends a data-free webhook signal", async () => {
    const storage = new MemoryObjectStorage();
    const repository = new MemoryDeliveryRepository();
    const notifications: unknown[] = [];
    const service = createSnapshotDeliveryService({
      repository,
      createProjectStorage: (projectId) => new ProjectSnapshotStorage(projectId, storage),
      now: () => new Date("2026-10-05T00:00:02.000Z"),
    });
    const snapshot = await fixture();
    const current = await service.stageArtifacts({ organizationId: "org-1", ...snapshot });
    let run = await service.registerPublication(current);
    notifications.push(service.webhookSignal(run));
    run = await service.recordNotified(run);

    expect(run.status).toBe("NOTIFIED");
    expect(storage.putCount).toBe(SNAPSHOT_DATASET_KINDS.length + 1);
    expect([...storage.entries.keys()].every((key) => key.startsWith("snapshots/project-1/"))).toBe(true);
    expect(notifications).toEqual([{ projectId: "project-1", publishSequence: 1 }]);
    expect(JSON.stringify(notifications)).not.toContain("files");
    await expect(service.getCurrentManifest("org-1", "project-1")).resolves.toMatchObject({ publishSequence: 1 });
  });

  it("keeps polling available when webhook notification fails", async () => {
    const repository = new MemoryDeliveryRepository();
    const service = createSnapshotDeliveryService({
      repository,
      createProjectStorage: (projectId) => new ProjectSnapshotStorage(projectId, new MemoryObjectStorage()),
      now: () => new Date("2026-10-05T00:00:02.000Z"),
    });
    const current = await service.stageArtifacts({ organizationId: "org-1", ...await fixture() });
    const run = await service.registerPublication(current);
    const unavailableWebhook: SnapshotWebhookNotifier = { async notify() { throw new Error("WEBHOOK_UNAVAILABLE"); } };
    await expect(unavailableWebhook.notify(service.webhookSignal(run))).rejects.toThrow("WEBHOOK_UNAVAILABLE");
    expect(run.status).toBe("PENDING");
    await expect(service.getCurrentManifest("org-1", "project-1")).resolves.toMatchObject({ publishSequence: 1 });
    await expect(service.recordDownloaded(run)).resolves.toMatchObject({ status: "DOWNLOADED" });
  });

  it("proves the ordered lifecycle and rejects skipped or terminal transitions", async () => {
    const repository = new MemoryDeliveryRepository();
    const service = createSnapshotDeliveryService({
      repository,
      createProjectStorage: (projectId) => new ProjectSnapshotStorage(projectId, new MemoryObjectStorage()),
      now: () => new Date("2026-10-05T00:00:02.000Z"),
    });
    let run = await service.registerPublication(await service.stageArtifacts({ organizationId: "org-1", ...await fixture() }));
    run = await service.recordNotified(run);
    await expect(service.recordApplied(run)).rejects.toThrow("DELIVERY_TRANSITION_CONFLICT");
    run = await service.recordDownloaded(run);
    run = await service.recordApplied(run);
    run = await service.recordAcknowledged(run);
    expect(run.status).toBe("ACKNOWLEDGED");
    await expect(service.recordFailed(run, "TOO_LATE")).rejects.toThrow("DELIVERY_TRANSITION_CONFLICT");
  });

  it("marks unacknowledged runs stale only after 24 hours and leaves ACK and FAILED terminal", async () => {
    const repository = new MemoryDeliveryRepository();
    let now = new Date("2026-10-05T00:00:02.000Z");
    const service = createSnapshotDeliveryService({
      repository,
      createProjectStorage: (projectId) => new ProjectSnapshotStorage(projectId, new MemoryObjectStorage()),
      now: () => now,
    });
    const active = await service.registerPublication(await service.stageArtifacts({ organizationId: "org-1", ...await fixture(1) }));
    const failed = await service.registerPublication(await service.stageArtifacts({ organizationId: "org-1", ...await fixture(2) }));
    await service.recordFailed(failed, "CLIENT_REJECTED");
    now = new Date("2026-10-06T00:00:00.999Z");
    await expect(service.markStaleDeliveries()).resolves.toBe(0);
    now = new Date("2026-10-06T00:00:01.000Z");
    await expect(service.markStaleDeliveries()).resolves.toBe(1);
    expect((await repository.getRun("org-1", "project-1", active.publishSequence))?.status).toBe("STALE");
    expect((await repository.getRun("org-1", "project-1", failed.publishSequence))?.status).toBe("FAILED");
  });
});
