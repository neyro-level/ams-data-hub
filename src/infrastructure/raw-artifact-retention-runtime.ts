import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createRawArtifactRetentionCutReader } from "./raw-artifact-retention-cut.ts";
import { acquireRawArtifactLifetimeGuard, createRawArtifactDeletionRepository } from "../modules/ingestion-core/server.ts";
import { planRawArtifactRetention, DEFAULT_RAW_ARTIFACT_RETENTION_POLICY } from "../modules/ingestion-core/index.ts";
import { getPrismaPool } from "../platform/database/prisma/client.ts";
import { runInAuthorizedDatabaseTransaction, type DatabaseTransaction } from "../platform/database/transaction.ts";
import { createProjectRawArtifactDeletionResolver } from "../platform/storage/project-object-storage.ts";
import type { RawArtifactDeletionStorage } from "../platform/storage/object-storage.ts";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const inputSchema = z.object({ organizationId: id, projectId: id, batchLimit: z.number().int().min(1).max(50).default(10) }).strict();
export interface RawArtifactRetentionResult { deleted: number; recovered: number; unknown: number; busy: number; retained: number; alreadyRemoved: number }

/** Actual one-shot command adapter; no implicit fleet/default-project selection. */
export function runRawArtifactRetentionCommand(args: readonly string[], signal: AbortSignal) {
  if (args.length < 2 || args.length > 3) throw new Error("RAW_RETENTION_COMMAND_INVALID");
  const batchLimit = args[2] === undefined ? 10 : /^[1-9][0-9]?$/u.test(args[2]) ? Number(args[2]) : NaN;
  return runRawArtifactRetention(inputSchema.parse({ organizationId: args[0], projectId: args[1], batchLimit }), signal);
}

/** No storage IO inside transactions. Every destructive attempt owns one SHA guardian. */
export async function runRawArtifactRetention(rawInput: z.input<typeof inputSchema>, signal: AbortSignal): Promise<RawArtifactRetentionResult> {
  const input = inputSchema.parse(rawInput); const scope = { organizationId: input.organizationId, projectId: input.projectId };
  const correlationId = randomUUID();
  const context = { principalKind: "project-job" as const, actorId: "raw-artifact-retention", organizationId: scope.organizationId,
    projectIds: [scope.projectId], correlationId };
  const transaction = <T>(execute: (tx: DatabaseTransaction) => Promise<T>) => runInAuthorizedDatabaseTransaction(context, execute,
    { isolationLevel: "ReadCommitted", maxWait: 2_000, timeout: 10_000 });
  const result: RawArtifactRetentionResult = { deleted: 0, recovered: 0, unknown: 0, busy: 0, retained: 0, alreadyRemoved: 0 };
  if (signal.aborted) return result;
  // Discovery is NOT authorization. Each target is re-cut after exclusive ownership.
  const initial = await transaction(async (tx) => {
    const cut = await createRawArtifactRetentionCutReader(tx).read(scope);
    const repository = createRawArtifactDeletionRepository(tx);
    const journal = await repository.list(scope);
    const decisions = planRawArtifactRetention({ ...scope, ...cut });
    result.retained = decisions.filter((decision) => !decision.eligible).length;
    const pending = new Set(journal.filter((row) => row.status === "PENDING").map((row) => row.rawArtifactHash));
    result.unknown = pending.size;
    const eligible = decisions.filter((decision) => decision.eligible && !pending.has(decision.rawArtifactHash));
    const availability = await repository.readAvailability(scope, eligible.map((row) => row.rawArtifactHash));
    // Already removed or ambiguous histories do not starve later eligible SHAs
    // in repeated bounded runs. Neither classification authorizes storage IO.
    result.alreadyRemoved = eligible.filter((row) => availability.get(row.rawArtifactHash) === "REMOVED").length;
    result.unknown += eligible.filter((row) => availability.get(row.rawArtifactHash) === "UNKNOWN").length;
    return [...new Set([...journal.filter((row) => row.status === "ACKNOWLEDGED").map((row) => row.rawArtifactHash),
      ...eligible.filter((row) => !["REMOVED", "UNKNOWN"].includes(availability.get(row.rawArtifactHash) ?? "")).map((row) => row.rawArtifactHash)])].slice(0, input.batchLimit);
  });
  let storage: RawArtifactDeletionStorage | undefined;
  try {
    for (const rawArtifactHash of initial) {
      if (signal.aborted) break;
      let guardian;
      try { guardian = await acquireRawArtifactLifetimeGuard(getPrismaPool(), { ...scope, rawArtifactHash }, "retention"); }
      catch (error) { if (error instanceof Error && error.message === "RAW_ARTIFACT_BUSY") { result.busy++; continue; } throw error; }
      let pendingId: string | undefined;
      let deleteStarted = false;
      try {
        const admission = await transaction(async (tx) => {
          await guardian.fence(tx);
          const repository = createRawArtifactDeletionRepository(tx);
          const target = await repository.readTarget(scope, rawArtifactHash);
          if (target.unsettled?.status === "ACKNOWLEDGED") {
            await repository.complete(scope, target.unsettled.id, correlationId); return { phase: "RECOVERED" as const };
          }
          if (target.unsettled) return { phase: "PENDING" as const };
          if (target.availability === "REMOVED") return { phase: "REMOVED" as const };
          if (target.availability === "UNKNOWN") return { phase: "UNKNOWN" as const };
          const cut = await createRawArtifactRetentionCutReader(tx).read(scope);
          const decision = planRawArtifactRetention({ ...scope, ...cut }).find((row) => row.rawArtifactHash === rawArtifactHash);
          if (!decision?.eligible || signal.aborted) return { phase: "RETAINED" as const };
          // Static binding/client construction performs no provider IO. Known
          // configuration errors must not create an irreversible unknown intent.
          // ACK recovery above deliberately does not need storage configuration.
          storage ??= createProjectRawArtifactDeletionResolver()(scope);
          const record = await repository.admit(scope, rawArtifactHash, { ...DEFAULT_RAW_ARTIFACT_RETENTION_POLICY });
          guardian.assertActive(); return { phase: "ADMITTED" as const, id: record.id };
        });
        if (admission.phase === "RECOVERED") { result.recovered++; continue; }
        if (admission.phase === "REMOVED") { result.alreadyRemoved++; continue; }
        if (admission.phase === "RETAINED") { result.retained++; continue; }
        if (admission.phase === "PENDING") { result.unknown++; continue; } // Concurrent admission; never repeat IO.
        if (admission.phase === "UNKNOWN") { result.unknown++; continue; }
        pendingId = admission.id;
        guardian.assertActive();
        const ioSignal = AbortSignal.any([signal, guardian.signal]);
        if (ioSignal.aborted) throw new Error("RAW_DELETE_IO_UNKNOWN");
        deleteStarted = true;
        await storage!.deleteRawArtifact({ rawArtifactHash, signal: ioSignal });
        await transaction(async (tx) => { await guardian.fence(tx); await createRawArtifactDeletionRepository(tx).acknowledge(scope, pendingId!); });
        // Separate durable ACK: a restart can complete this stage with zero IO.
        await transaction(async (tx) => { await guardian.fence(tx); await createRawArtifactDeletionRepository(tx).complete(scope, pendingId!, correlationId); });
        result.deleted++;
      } catch (error) {
        if (!pendingId) throw error;
        const code = guardian.signal.aborted ? "RAW_DELETE_LEASE_LOST" : "RAW_DELETE_IO_UNKNOWN";
        // A journal commit failure after ACK is not an unknown DELETE; retain ACK
        // for restart. Lost guardians cannot authorize ACK, only annotate PENDING.
        await transaction(async (tx) => {
          const repository = createRawArtifactDeletionRepository(tx);
          const state = await repository.readTarget(scope, rawArtifactHash);
          if (state.unsettled?.id === pendingId && state.unsettled.status === "PENDING") await repository.unknown(scope, pendingId!, code);
        });
        result.unknown++;
        // Configuration failures are actionable; never silently mark the run green.
        if (!deleteStarted) throw error;
      } finally { await guardian.release(); }
    }
    return result;
  } finally { storage?.close(); }
}
