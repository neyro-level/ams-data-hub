import "server-only";
import { z } from "zod";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { createDatabaseAuthorizationContext, runInAuthorizedDatabaseTransaction, type DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { defineSecretRef, resolveSecretRef } from "../../../platform/security/secret-ref.ts";
import { hashProjectAckToken, verifyProjectAckToken } from "../application/snapshot-ack.ts";
import { PrismaSnapshotDeliveryRepository } from "./prisma-snapshot-delivery-repository.ts";

const requestSchema = z.object({ requestId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),
  phase: z.enum(["STAGE", "PROMOTE"]), expectedVersion: z.number().int().positive().max(2_147_483_646) }).strict();
const refSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u);
type Scope = { organizationId: string; projectId: string };

/** The only returned value is an owned finish closure. Token/hash never escapes
 * the snapshot owner; scrypt happens outside the final transaction. */
export function createSnapshotAckRotationServer(dependencies: {
  resolveNextTokenRef(scope: Scope): string;
  environment?: Readonly<Record<string, string | undefined>>;
}) {
  return async (principal: PrincipalContext, rawRequest: z.input<typeof requestSchema>, signal?: AbortSignal) => {
    if (principal.kind !== "project-job" || principal.jobName !== "snapshot-ack-rotation") throw new Error("ACK_ROTATION_ACCESS_DENIED");
    const scope = { organizationId: principal.organizationId, projectId: principal.projectId };
    const request = requestSchema.parse(rawRequest);
    const cancelled = () => { if (signal?.aborted) throw new Error("OPERATIONS_CONTROL_EXECUTION_CANCELLED"); };
    cancelled();
    const captured = await runInAuthorizedDatabaseTransaction(createDatabaseAuthorizationContext(principal), async (tx) => {
      const credential = await new PrismaSnapshotDeliveryRepository(tx).getAckCredential(scope.organizationId, scope.projectId);
      if (!credential) throw new Error("ACK_CREDENTIAL_NOT_CONFIGURED");
      if (credential.version !== request.expectedVersion) throw new Error("ACK_CREDENTIAL_STALE");
      if (request.phase === "STAGE" && credential.nextTokenHash) throw new Error("ACK_ROTATION_ALREADY_STAGED");
      if (request.phase === "PROMOTE" && !credential.nextTokenHash) throw new Error("ACK_ROTATION_NOT_STAGED");
      return credential;
    }, { isolationLevel: "RepeatableRead", maxWait: 2000, timeout: 5000 });
    cancelled(); let nextHash: string | null = null;
    if (request.phase === "STAGE") {
      try {
        const ref = defineSecretRef(refSchema.parse(dependencies.resolveNextTokenRef(scope)));
        const token = resolveSecretRef(ref, dependencies.environment ?? process.env);
        if (Buffer.byteLength(token,"utf8") < 32 || Buffer.byteLength(token,"utf8") > 512
          || verifyProjectAckToken(token,captured.currentTokenHash)) throw new Error();
        nextHash = hashProjectAckToken(token);
      } catch { throw new Error("ACK_ROTATION_CONFIGURATION_INVALID"); }
    }
    cancelled();
    return async (tx: DatabaseTransaction) => {
      cancelled();
      const allowed = await tx.$queryRaw<{ allowed: boolean }[]>(Prisma.sql`SELECT snapshot_ack_rotation_scope(${scope.organizationId},${scope.projectId}) AS allowed`);
      if (allowed[0]?.allowed !== true) throw new Error("ACK_ROTATION_ACCESS_DENIED");
      await tx.$executeRaw(Prisma.sql`SELECT set_config('app.ack_rotation_request_id',${request.requestId},true)`);
      const repo = new PrismaSnapshotDeliveryRepository(tx);
      const credential = await repo.getAckCredential(scope.organizationId,scope.projectId);
      if (!credential || credential.version !== captured.version || credential.currentTokenHash !== captured.currentTokenHash
        || credential.nextTokenHash !== captured.nextTokenHash) throw new Error("ACK_CREDENTIAL_STALE");
      await repo.saveAckCredential({ ...scope, expectedVersion: captured.version,
        currentTokenHash: request.phase === "PROMOTE" ? captured.nextTokenHash! : captured.currentTokenHash,
        nextTokenHash: request.phase === "STAGE" ? nextHash : null,
        rotatedAt: request.phase === "PROMOTE" ? new Date() : null });
      cancelled();
      return { action: "ACK_ROTATE" as const, phase: request.phase,
        previousCredentialVersion: captured.version, credentialVersion: captured.version + 1 };
    };
  };
}
