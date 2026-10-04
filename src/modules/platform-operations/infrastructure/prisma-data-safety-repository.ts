import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { DataSafetyRepository, DataSafetySnapshot } from "../application/data-safety-service.ts";

const selectState = { jobsFrozen: true, frozenAt: true, reconciledAt: true } as const;

export class PrismaDataSafetyRepository implements DataSafetyRepository {
  public constructor(private readonly transaction: DatabaseTransaction) {}

  public freeze(reason: string, now: Date): Promise<DataSafetySnapshot> {
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
}
