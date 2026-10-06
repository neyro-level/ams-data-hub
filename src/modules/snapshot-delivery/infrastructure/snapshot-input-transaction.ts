import "server-only";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { createDatabaseAuthorizationContext, runInAuthorizedDatabaseTransaction,
  type DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { PrismaSnapshotInputRepository } from "./prisma-snapshot-input-repository.ts";

function retryable(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && (error.code === "P2034" || (error.code === "P2010" && error.meta?.code === "40001"))
    || error instanceof Error && error.message === "SNAPSHOT_SEQUENCE_CONFLICT";
}

/** Command runner for DB-only capture. No IO or publication inside execute. */
export async function runInSnapshotInputTransaction<T>(principal: PrincipalContext,
  execute: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
  if (principal.kind !== "project-job" || principal.jobName !== "snapshot-input") {
    throw new Error("SNAPSHOT_INPUT_ACCESS_DENIED");
  }
  const context = createDatabaseAuthorizationContext(principal);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await runInAuthorizedDatabaseTransaction(context, async (transaction) => {
        await new PrismaSnapshotInputRepository(transaction).lockProject(principal.organizationId, principal.projectId);
        // set_config/the first RR statement can predate waiting for the safety
        // lock. A bounded second authorized connection reads CURRENT admission
        // while the outer lock prevents freeze/service-state changes. Facts
        // remain in the one outer RR cut; no privileged DB function or grants.
        await runInAuthorizedDatabaseTransaction(context, async (admission) => {
          const safety = await admission.dataSafetyState.findUnique({ where: { id: "global" }, select: { jobsFrozen: true } });
          if (!safety || safety.jobsFrozen) throw new Error("SNAPSHOT_INPUT_JOBS_FROZEN");
          const project = await admission.project.findFirst({
            where: { organizationId: principal.organizationId, id: principal.projectId },
            select: { status: true, serviceState: true },
          });
          if (!project || project.status !== "ACTIVE" || project.serviceState !== "ACTIVE") {
            throw new Error("SNAPSHOT_INPUT_PROJECT_BLOCKED");
          }
        }, { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 5000 });
        return execute(transaction);
      }, { isolationLevel: "RepeatableRead", maxWait: 2000, timeout: 30_000 });
    } catch (error) {
      if (!retryable(error)) throw error;
    }
  }
  throw new Error("SNAPSHOT_INPUT_RETRY_EXHAUSTED");
}
