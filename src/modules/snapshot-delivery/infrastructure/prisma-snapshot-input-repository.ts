import "server-only";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import {
  SNAPSHOT_INPUT_SCHEMA_VERSION, SNAPSHOT_INPUT_PROJECTOR_VERSION,
  SnapshotInputPartsBuilder, snapshotInputHash, snapshotBuildInputDigest,
  type SnapshotBuildInputReceipt, type SnapshotInputPart,
} from "../application/snapshot-build-input.ts";
import type { CanonicalJsonValue } from "@ams-data-hub/data-contracts";

export class PrismaSnapshotInputRepository {
  constructor(private readonly transaction: DatabaseTransaction) {}

  async lockProject(organizationId: string, projectId: string): Promise<void> {
    await this.transaction.$queryRaw(Prisma.sql`select pg_advisory_xact_lock(
      hashtextextended(${JSON.stringify(["snapshot-input", organizationId, projectId])}, 0))::text`);
  }

  async find(organizationId: string, projectId: string, idempotencyKeyHash: string,
    requestHash: string): Promise<SnapshotBuildInputReceipt | null> {
    const value = await this.transaction.snapshotBuildInput.findUnique({
      where: { organizationId_projectId_idempotencyKeyHash: { organizationId, projectId, idempotencyKeyHash } },
    });
    if (!value) return null;
    if (value.requestHash !== requestHash) throw new Error("SNAPSHOT_INPUT_IDEMPOTENCY_CONFLICT");
    const builder = new SnapshotInputPartsBuilder();
    const counters = new Map<string, number>();
    let cursor: { buildInputId: string; kind: string; partIndex: number } | undefined;
    while (true) {
      // At most one SQL-bounded payload is materialized before the total-work
      // budget is charged. Never include an unbounded receipt relation.
      const page = await this.transaction.snapshotBuildInputPart.findMany({
        where: { organizationId, projectId, buildInputId: value.id },
        orderBy: [{ kind: "asc" }, { partIndex: "asc" }], take: 1,
        ...(cursor ? { cursor: { buildInputId_kind_partIndex: cursor }, skip: 1 } : {}),
      });
      const part = page[0];
      if (!part) break;
      if (!Array.isArray(part.payload) || part.partIndex !== (counters.get(part.kind) ?? 0)
        || snapshotInputHash(part.payload as CanonicalJsonValue[]) !== part.payloadHash) {
        throw new Error("SNAPSHOT_INPUT_INTEGRITY_INVALID");
      }
      builder.add(part.kind as SnapshotInputPart["kind"], part.payload as CanonicalJsonValue[]);
      counters.set(part.kind, part.partIndex + 1);
      cursor = { buildInputId: part.buildInputId, kind: part.kind, partIndex: part.partIndex };
    }
    const { captureTransactionId: _transactionId, ...header } = value;
    void _transactionId;
    const receipt = { ...header, parts: builder.finish() };
    if (receipt.inputSchemaVersion !== SNAPSHOT_INPUT_SCHEMA_VERSION
      || receipt.projectorVersion !== SNAPSHOT_INPUT_PROJECTOR_VERSION
      || snapshotBuildInputDigest(receipt) !== receipt.inputHash) throw new Error("SNAPSHOT_INPUT_INTEGRITY_INVALID");
    return receipt;
  }

  /** Called after lockProject, inside the same bounded capture transaction. */
  async reserveSequence(organizationId: string, projectId: string): Promise<number> {
    const scope = { organizationId, projectId };
    const [current, deliveries, captures] = await Promise.all([
      this.transaction.projectCurrentSnapshotManifest.findUnique({ where: { organizationId_projectId: scope }, select: { publishSequence: true } }),
      this.transaction.deliveryRun.aggregate({ where: scope, _max: { publishSequence: true } }),
      this.transaction.snapshotBuildInput.aggregate({ where: scope, _max: { publishSequence: true } }),
    ]);
    const floor = Math.max(current?.publishSequence ?? 0, deliveries._max.publishSequence ?? 0,
      captures._max.publishSequence ?? 0);
    const counter = await this.transaction.projectSnapshotSequence.upsert({
      where: { organizationId_projectId: scope }, create: { ...scope, lastReservedSequence: floor }, update: {},
      select: { lastReservedSequence: true },
    });
    const previous = counter.lastReservedSequence;
    const next = Math.max(previous, floor) + 1;
    if (!Number.isSafeInteger(next) || next > 2_147_483_647) throw new Error("SNAPSHOT_SEQUENCE_EXHAUSTED");
    const changed = await this.transaction.projectSnapshotSequence.updateMany({
      where: { ...scope, lastReservedSequence: previous }, data: { lastReservedSequence: next },
    });
    if (changed.count !== 1) throw new Error("SNAPSHOT_SEQUENCE_CONFLICT");
    return next;
  }

  async save(input: Omit<SnapshotBuildInputReceipt, "id" | "inputHash">): Promise<SnapshotBuildInputReceipt> {
    const builder = new SnapshotInputPartsBuilder();
    for (const part of input.parts) builder.add(part.kind, part.payload);
    const parts = builder.finish();
    if (parts.length !== input.parts.length || parts.some((part, index) =>
      part.kind !== input.parts[index]!.kind || part.partIndex !== input.parts[index]!.partIndex
      || part.payloadHash !== input.parts[index]!.payloadHash)) throw new Error("SNAPSHOT_INPUT_INTEGRITY_INVALID");
    const { parts: _parts, ...header } = input;
    void _parts;
    const inputHash = snapshotBuildInputDigest({ ...input, parts });
    const saved = await this.transaction.snapshotBuildInput.create({ data: { ...header, inputHash }, select: { id: true } });
    await this.transaction.snapshotBuildInputPart.createMany({ data: parts.map((part) => ({
      organizationId: input.organizationId, projectId: input.projectId, buildInputId: saved.id,
      ...part, payload: part.payload as Prisma.InputJsonArray,
    })) });
    return { ...header, ...saved, inputHash, parts };
  }
}
