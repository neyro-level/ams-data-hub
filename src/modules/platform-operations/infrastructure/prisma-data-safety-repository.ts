import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DataSafetyRepository, DataSafetySnapshot } from "../application/data-safety-service.ts";

const selectState = { jobsFrozen: true, frozenAt: true, reconciledAt: true } as const;

export class PrismaDataSafetyRepository implements DataSafetyRepository {
  public constructor(private readonly transaction: DatabaseTransaction) {}

  public async freeze(reason: string, now: Date): Promise<DataSafetySnapshot> {
    await this.transaction.$queryRaw(Prisma.sql`select pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations', 0))::text`);
    return this.transaction.dataSafetyState.upsert({
      where: { id: "global" },
      create: { id: "global", jobsFrozen: true, freezeReason: reason, frozenAt: now, reconciledAt: null, unfrozenAt: null },
      update: { jobsFrozen: true, freezeReason: reason, frozenAt: now, reconciledAt: null, unfrozenAt: null },
      select: selectState,
    });
  }

  public markReconciled(now: Date): Promise<DataSafetySnapshot> {
    return this.transaction.dataSafetyState.upsert({
      where: { id: "global" },
      create: { id: "global", jobsFrozen: true, freezeReason: "restore-reconcile", frozenAt: now, reconciledAt: now, unfrozenAt: null },
      update: { reconciledAt: now },
      select: selectState,
    });
  }

  public unfreeze(now: Date): Promise<DataSafetySnapshot> {
    return this.transaction.dataSafetyState.update({
      where: { id: "global" },
      data: { jobsFrozen: false, unfrozenAt: now },
      select: selectState,
    });
  }

  public async read(): Promise<DataSafetySnapshot> {
    return (await this.transaction.dataSafetyState.findUnique({ where: { id: "global" }, select: selectState }))
      ?? { jobsFrozen: true, frozenAt: null, reconciledAt: null };
  }

  public async appendAudit(input: {
    actorId: string;
    correlationId: string;
    action: "data-safety.freeze" | "data-safety.reconcile" | "data-safety.unfreeze";
    afterMarker: Record<string, string | number | boolean>;
  }): Promise<void> {
    await this.transaction.auditEvent.create({
      data: {
        organizationId: null,
        actorType: "USER",
        actorId: input.actorId,
        action: input.action,
        entityType: "DataSafetyState",
        entityId: "global",
        afterMarker: input.afterMarker,
        source: "platform-operations",
        correlationId: input.correlationId,
      },
    });
  }
}
