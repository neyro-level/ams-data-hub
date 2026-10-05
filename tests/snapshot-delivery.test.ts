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
  composeRollbackSnapshot,
  createSnapshotDeliveryService,
  createSnapshotAckService,
  hashProjectAckToken,
  signSnapshotManifest,
  verifyProjectAckToken,
  type CurrentSnapshotManifest,
  type DeliveryRun,
  type DeliveryRunStatus,
  type SnapshotDeliveryRepository,
  type SnapshotSigner,
  type SnapshotWebhookNotifier,
  type ProjectAckCredential,
  type TransitionDeliveryRunInput,
} from "../src/modules/snapshot-delivery/index.ts";
import { assertProjectOperationAllowed, projectServicePolicy } from "../src/modules/project-registry/index.ts";

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
  credential: ProjectAckCredential | null = null;

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
      ackIdempotencyKeyHash: null,
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
  async getAckCredential(organizationId: string, projectId: string) {
    return this.credential?.organizationId === organizationId && this.credential.projectId === projectId ? this.credential : null;
  }
  async saveAckCredential(input: Omit<ProjectAckCredential, "version"> & { expectedVersion: number; rotatedAt: Date | null }) {
    if (input.expectedVersion === 0) {
      if (this.credential) throw new Error("ACK_CREDENTIAL_STALE");
      this.credential = { organizationId: input.organizationId, projectId: input.projectId, currentTokenHash: input.currentTokenHash, nextTokenHash: input.nextTokenHash, version: 1 };
      return this.credential;
    }
    if (!this.credential || this.credential.version !== input.expectedVersion) throw new Error("ACK_CREDENTIAL_STALE");
    this.credential = { organizationId: input.organizationId, projectId: input.projectId, currentTokenHash: input.currentTokenHash, nextTokenHash: input.nextTokenHash, version: input.expectedVersion + 1 };
    return this.credential;
  }
  async acknowledgeApplied(input: { organizationId: string; projectId: string; publishSequence: number; idempotencyKeyHash: string; acknowledgedAt: Date }) {
    const run = await this.getRun(input.organizationId, input.projectId, input.publishSequence);
    if (!run) throw new Error("ACK_DELIVERY_RUN_NOT_FOUND");
    if (run.status === "ACKNOWLEDGED") {
      if (run.ackIdempotencyKeyHash !== input.idempotencyKeyHash) throw new Error("ACK_REPLAY_REJECTED");
      return { run, idempotent: true };
    }
    if (run.status !== "APPLIED") throw new Error("ACK_DELIVERY_NOT_APPLIED");
    run.status = "ACKNOWLEDGED";
    run.acknowledgedAt = input.acknowledgedAt;
    run.ackIdempotencyKeyHash = input.idempotencyKeyHash;
    return { run, idempotent: false };
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
    let run = await service.registerPublication(current, "ACTIVE");
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
    const run = await service.registerPublication(current, "ACTIVE");
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
    let run = await service.registerPublication(await service.stageArtifacts({ organizationId: "org-1", ...await fixture() }), "ACTIVE");
    run = await service.recordNotified(run);
    await expect(service.recordApplied(run)).rejects.toThrow("DELIVERY_TRANSITION_CONFLICT");
    run = await service.recordDownloaded(run);
    run = await service.recordApplied(run);
    expect(run.status).toBe("APPLIED");
    await expect(service.recordDownloaded(run)).rejects.toThrow("DELIVERY_TRANSITION_CONFLICT");
  });

  it("rejects a signed manifest that does not match the composed artifacts", async () => {
    const repository = new MemoryDeliveryRepository();
    const service = createSnapshotDeliveryService({
      repository,
      createProjectStorage: (projectId) => new ProjectSnapshotStorage(projectId, new MemoryObjectStorage()),
      now: () => new Date("2026-10-05T00:00:02.000Z"),
    });
    const snapshot = await fixture();
    await expect(service.stageArtifacts({
      organizationId: "org-1",
      composition: snapshot.composition,
      manifest: { ...snapshot.manifest, catalogRevision: "tampered-catalog" },
    })).rejects.toThrow("SNAPSHOT_DELIVERY_MANIFEST_MISMATCH");
  });

  it("marks unacknowledged runs stale only after 24 hours and leaves ACK and FAILED terminal", async () => {
    const repository = new MemoryDeliveryRepository();
    let now = new Date("2026-10-05T00:00:02.000Z");
    const service = createSnapshotDeliveryService({
      repository,
      createProjectStorage: (projectId) => new ProjectSnapshotStorage(projectId, new MemoryObjectStorage()),
      now: () => now,
    });
    const active = await service.registerPublication(await service.stageArtifacts({ organizationId: "org-1", ...await fixture(1) }), "ACTIVE");
    const failed = await service.registerPublication(await service.stageArtifacts({ organizationId: "org-1", ...await fixture(2) }), "ACTIVE");
    await service.recordFailed(failed, "CLIENT_REJECTED");
    now = new Date("2026-10-06T00:00:00.999Z");
    await expect(service.markStaleDeliveries()).resolves.toBe(0);
    now = new Date("2026-10-06T00:00:01.000Z");
    await expect(service.markStaleDeliveries()).resolves.toBe(1);
    expect((await repository.getRun("org-1", "project-1", active.publishSequence))?.status).toBe("STALE");
    expect((await repository.getRun("org-1", "project-1", failed.publishSequence))?.status).toBe("FAILED");
  });

  it("blocks ingestion and publication while suspended, preserves last-good read, and resumes at a higher sequence", async () => {
    const repository = new MemoryDeliveryRepository();
    const service = createSnapshotDeliveryService({ repository, createProjectStorage: (projectId) => new ProjectSnapshotStorage(projectId, new MemoryObjectStorage()), now: () => new Date("2026-10-05T00:00:02.000Z") });
    const first = await service.stageArtifacts({ organizationId: "org-1", ...await fixture(1) });
    await service.registerPublication(first, "ACTIVE");
    const suspendedCandidate = await service.stageArtifacts({ organizationId: "org-1", ...await fixture(2) });
    expect(() => service.registerPublication(suspendedCandidate, "SUSPENDED")).toThrow("PROJECT_SERVICE_SUSPENDED:PUBLISH");
    expect(() => assertProjectOperationAllowed("SUSPENDED", "INGEST")).toThrow("PROJECT_SERVICE_SUSPENDED:INGEST");
    expect(projectServicePolicy("SUSPENDED")).toEqual({ canIngest: false, canPublish: false, canReadPublished: true });
    await expect(service.getCurrentManifest("org-1", "project-1")).resolves.toMatchObject({ publishSequence: 1 });
    await expect(service.registerPublication(suspendedCandidate, "ACTIVE")).resolves.toMatchObject({ publishSequence: 2 });
  });
});

describe("snapshot ACK", () => {
  const currentToken = "current-project-token-value-000001";
  const nextToken = "next-project-token-value-000000002";

  it("stores only salted token hashes and supports overlap rotation", async () => {
    const repository = new MemoryDeliveryRepository();
    const service = createSnapshotAckService({ repository, now: () => new Date("2026-10-05T01:00:00.000Z") });
    let credential = await service.initializeCredential({ organizationId: "org-1", projectId: "project-1", token: currentToken });
    expect(credential.currentTokenHash).not.toContain(currentToken);
    expect(verifyProjectAckToken(currentToken, credential.currentTokenHash)).toBe(true);
    credential = await service.stageRotation(credential, nextToken);
    expect(verifyProjectAckToken(currentToken, credential.currentTokenHash)).toBe(true);
    expect(verifyProjectAckToken(nextToken, credential.nextTokenHash!)).toBe(true);
    credential = await service.promoteRotation(credential);
    expect(credential.nextTokenHash).toBeNull();
    expect(verifyProjectAckToken(nextToken, credential.currentTokenHash)).toBe(true);
    expect(verifyProjectAckToken(currentToken, credential.currentTokenHash)).toBe(false);
  });

  it("binds ACK to project plus sequence, is idempotent for the same key, and rejects replay", async () => {
    const repository = new MemoryDeliveryRepository();
    const delivery = createSnapshotDeliveryService({ repository, createProjectStorage: (projectId) => new ProjectSnapshotStorage(projectId, new MemoryObjectStorage()), now: () => new Date("2026-10-05T00:00:02.000Z") });
    let run = await delivery.registerPublication(await delivery.stageArtifacts({ organizationId: "org-1", ...await fixture() }), "ACTIVE");
    run = await delivery.recordDownloaded(run);
    await delivery.recordApplied(run);
    const ack = createSnapshotAckService({ repository, now: () => new Date("2026-10-05T00:03:00.000Z") });
    await ack.initializeCredential({ organizationId: "org-1", projectId: "project-1", token: currentToken });
    const request = { organizationId: "org-1", projectId: "project-1", publishSequence: 1, token: currentToken, idempotencyKey: "ack-request-0000000001" };
    await expect(ack.acknowledge(request)).resolves.toMatchObject({ idempotent: false, run: { status: "ACKNOWLEDGED" } });
    await expect(ack.acknowledge(request)).resolves.toMatchObject({ idempotent: true });
    await expect(ack.acknowledge({ ...request, idempotencyKey: "ack-request-0000000002" })).rejects.toThrow("ACK_REPLAY_REJECTED");
    await expect(ack.acknowledge({ ...request, projectId: "project-2" })).rejects.toThrow("ACK_CREDENTIAL_NOT_CONFIGURED");
    await expect(ack.acknowledge({ ...request, publishSequence: 2 })).rejects.toThrow("ACK_DELIVERY_RUN_NOT_FOUND");
    await expect(ack.acknowledge({ ...request, token: "wrong-project-token-value-0000000" })).rejects.toThrow("ACK_AUTHENTICATION_FAILED");
  });

  it("uses a different salted hash for the same token", () => {
    expect(hashProjectAckToken(currentToken)).not.toBe(hashProjectAckToken(currentToken));
  });
});

describe("snapshot rollback", () => {
  it("reuses old immutable content only through a new higher-sequence manifest", async () => {
    const source = (await fixture(2)).composition;
    const rollback = composeRollbackSnapshot({
      source,
      currentPublishSequence: 7,
      generatedAt: "2026-10-06T00:00:00.000Z",
      publishedAt: "2026-10-06T00:00:01.000Z",
      keyId: "rollback-key",
    });
    expect(rollback.manifest.publishSequence).toBe(8);
    expect(rollback.manifest.keyId).toBe("rollback-key");
    expect(rollback.manifest.files).toEqual(source.manifest.files);
    expect(rollback.files.map((file) => file.manifest.sha256)).toEqual(source.files.map((file) => file.manifest.sha256));
    expect(rollback.manifestPayload).not.toEqual(source.manifestPayload);
  });

  it("rejects a source sequence newer than the current published sequence", async () => {
    const source = (await fixture(5)).composition;
    expect(() => composeRollbackSnapshot({
      source,
      currentPublishSequence: 4,
      generatedAt: "2026-10-06T00:00:00.000Z",
      publishedAt: "2026-10-06T00:00:01.000Z",
      keyId: "rollback-key",
    })).toThrow("SNAPSHOT_ROLLBACK_SOURCE_IS_FUTURE");
  });
});
