import "server-only";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { createProjectJobPrincipal } from "../../../platform/authorization/principal-factories.ts";
import { sourceSafetyPolicySchema } from "../domain/source-safety-policy-schema.ts";
import { normalizedContentHash } from "../application/import-pipeline.ts";
import { lockSourceIdentities } from "./source-identity-lock.ts";
import { PrismaSourceExecutionRepository, type SourceApplyContext } from "./prisma-source-execution-repository.ts";

/** Caller already owns the accepted request lease in its atomic final cut.
 * This ingestion-owned seam reuses actual apply, not a status-only shortcut. */
export async function applySuspiciousRevisionApproval(tx: DatabaseTransaction, input: {
  organizationId: string; projectId: string; sourceId: string; sourceRevisionId: string;
  requestId: string; correlationId: string;
}, signal?: AbortSignal) {
  const cancelled = () => { if (signal?.aborted) throw new Error("OPERATIONS_CONTROL_EXECUTION_CANCELLED"); };
  cancelled(); await lockSourceIdentities(tx,input);
  const bounded = await tx.$queryRaw<{ bounded: boolean }[]>(Prisma.sql`
    SELECT (octet_length("safetyPolicy"::text)<=4096 AND "safetyAnalysis" IS NOT NULL
      AND octet_length("safetyAnalysis"::text)<=4096) AS bounded FROM "SourceRevision"
    WHERE "organizationId"=${input.organizationId} AND "projectId"=${input.projectId} AND "sourceId"=${input.sourceId}
      AND id=${input.sourceRevisionId} AND status='SUSPICIOUS' FOR UPDATE`);
  if (bounded[0]?.bounded !== true) throw new Error("SOURCE_REVISION_MANUAL_APPROVAL_INVALID");
  const target = { organizationId: input.organizationId, projectId: input.projectId, sourceId: input.sourceId };
  const revision = await tx.sourceRevision.findFirstOrThrow({ where: { ...target,id: input.sourceRevisionId,status: "SUSPICIOUS" } });
  const source = await tx.source.findFirstOrThrow({ where: { organizationId: input.organizationId,projectId: input.projectId,id: input.sourceId } });
  const previous = revision.baseLastGoodRevisionId ? await tx.sourceRevision.findFirst({ where: { ...target,id: revision.baseLastGoodRevisionId,status: "GOOD" },select: { id: true,recordCount: true } }) : null;
  if (revision.baseLastGoodRevisionId && !previous) throw new Error("SOURCE_REVISION_MANUAL_APPROVAL_INVALID");
  if (source.safetyPolicyId) {
    const policyBound = await tx.$queryRaw<{ bounded: boolean }[]>(Prisma.sql`SELECT octet_length(policy::text)<=4096 AS bounded FROM "SourceSafetyPolicy"
      WHERE "organizationId"=${input.organizationId} AND "projectId"=${input.projectId} AND id=${source.safetyPolicyId}`);
    if (policyBound[0]?.bounded !== true) throw new Error("SOURCE_EXECUTION_POLICY_STALE");
  }
  const policy = source.safetyPolicyId ? await tx.sourceSafetyPolicy.findFirstOrThrow({ where: { organizationId: input.organizationId,projectId: input.projectId,id: source.safetyPolicyId } }) : null;
  if ((policy?.version ?? null) !== revision.safetyPolicyVersion
    || (policy && normalizedContentHash(sourceSafetyPolicySchema.parse(policy.policy)) !== normalizedContentHash(sourceSafetyPolicySchema.parse(revision.safetyPolicy))))
    throw new Error("SOURCE_EXECUTION_POLICY_STALE");
  const principal = createProjectJobPrincipal({ ...target,jobName: "source-import",correlationId: input.correlationId });
  if (principal.kind !== "project-job") throw new Error("SOURCE_OPERATION_APPROVAL_INVALID");
  const context: SourceApplyContext = { target, source, principal,
    safetyPolicy: sourceSafetyPolicySchema.parse(revision.safetyPolicy),lastGood: previous ? { revisionId: previous.id,recordCount: previous.recordCount } : null };
  const repo = new PrismaSourceExecutionRepository(tx); await repo.lockSource(context);
  const approval = { requestId: input.requestId,reviewedAt: new Date() };
  const plan = await repo.plan(context,revision.id,approval); cancelled();
  const good = await repo.apply(context,revision.id,plan,undefined,approval); cancelled();
  const q = await tx.$queryRaw<{ requestedBy: string }[]>(Prisma.sql`SELECT * FROM source_manual_approval_request(${input.organizationId},${input.projectId},${input.sourceId},${revision.id},${input.requestId})`);
  await tx.auditEvent.create({ data: { organizationId: input.organizationId,actorType: "USER",actorId: q[0]!.requestedBy,
    action: "operations-control.suspicious.approved",entityType: "SourceRevision",entityId: revision.id,source: "operations-control",correlationId: input.correlationId,
    afterMarker: { requestId: input.requestId,projectId: input.projectId,decision: "APPROVED",sequence: good.sequence } } });
  cancelled(); return { action: "SUSPICIOUS_APPROVE" as const,sourceRevisionId: good.revisionId,sequence: good.sequence,snapshotTriggered: true as const };
}
