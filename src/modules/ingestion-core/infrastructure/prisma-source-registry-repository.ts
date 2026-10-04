import { Prisma } from "../../../generated/prisma/client.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import {
  sourceSchedulePolicySchema,
  type CreateSourceInput,
  type RequestManualSourceRunInput,
  type SetSourceEnabledInput,
  type SourceKey,
  type UpdateSourceInput,
  type SourceProjectOption,
} from "../contracts.ts";
import type {
  SourceRegistryAuditInput,
  SourceRegistryRepository,
  StoredSource,
} from "../application/ports/source-registry-repository.ts";
import { SourceRegistryError } from "../domain/source-registry-error.ts";

const sourceInclude = {
  credentialRef: { select: { endpointCredentialRefName: true } },
  _count: { select: { manualRunRequests: { where: { status: "REQUESTED" as const } } } },
} as const;

function toStoredSource(row: {
  id: string;
  organizationId: string;
  projectId: string;
  sourceKey: string;
  name: string;
  adapterKey: string;
  adapterVersion: string;
  profileKey: string;
  profileVersion: string;
  datasetType: StoredSource["datasetType"];
  transportType: "HTTPS_XML";
  sharingPolicy: "PROJECT_ONLY";
  schedulePolicy: unknown;
  safetyPolicyId: string | null;
  enabled: boolean;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastGoodRevisionId: string | null;
  expectedNamespace: string | null;
  expectedProducer: string | null;
  version: number;
  updatedAt: Date;
  credentialRef: { endpointCredentialRefName: string } | null;
  _count: { manualRunRequests: number };
}): StoredSource {
  if (!row.credentialRef) throw new SourceRegistryError("SOURCE_REGISTRY_REFERENCE_INVALID");
  return {
    sourceId: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    sourceKey: row.sourceKey,
    name: row.name,
    endpointCredentialRefName: row.credentialRef.endpointCredentialRefName,
    adapterKey: row.adapterKey,
    adapterVersion: row.adapterVersion,
    profileKey: row.profileKey,
    profileVersion: row.profileVersion,
    datasetType: row.datasetType,
    transportType: row.transportType,
    sharingPolicy: row.sharingPolicy,
    schedulePolicy: sourceSchedulePolicySchema.parse(row.schedulePolicy),
    safetyPolicyId: row.safetyPolicyId,
    enabled: row.enabled,
    lastAttemptAt: row.lastAttemptAt,
    lastSuccessAt: row.lastSuccessAt,
    lastGoodRevisionId: row.lastGoodRevisionId,
    expectedNamespace: row.expectedNamespace,
    expectedProducer: row.expectedProducer,
    pendingManualRuns: row._count.manualRunRequests,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

function translateWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") throw new SourceRegistryError("SOURCE_REGISTRY_CONFLICT");
    if (error.code === "P2003") throw new SourceRegistryError("SOURCE_REGISTRY_REFERENCE_INVALID");
  }
  throw error;
}

function markerJson(marker: Record<string, string | number | boolean>): Prisma.InputJsonObject {
  return { ...marker };
}

function configData(input: CreateSourceInput | UpdateSourceInput) {
  return {
    name: input.name,
    adapterKey: input.adapterKey,
    adapterVersion: input.adapterVersion,
    profileKey: input.profileKey,
    profileVersion: input.profileVersion,
    datasetType: input.datasetType,
    schedulePolicy: input.schedulePolicy,
    safetyPolicyId: input.safetyPolicyId || null,
    expectedNamespace: input.expectedNamespace || null,
    expectedProducer: input.expectedProducer || null,
  };
}

export class PrismaSourceRegistryRepository implements SourceRegistryRepository {
  constructor(private readonly transaction: DatabaseTransaction) {}

  async projectExists(organizationId: string, projectId: string): Promise<boolean> {
    return await this.transaction.project.count({ where: { organizationId, id: projectId } }) === 1;
  }

  async findSource(key: SourceKey): Promise<StoredSource | null> {
    const row = await this.transaction.source.findFirst({
      where: { organizationId: key.organizationId, projectId: key.projectId, id: key.sourceId },
      include: sourceInclude,
    });
    return row ? toStoredSource(row) : null;
  }

  async listSources(organizationId?: string, projectId?: string): Promise<StoredSource[]> {
    const rows = await this.transaction.source.findMany({
      where: { ...(organizationId ? { organizationId } : {}), ...(projectId ? { projectId } : {}) },
      include: sourceInclude,
      orderBy: [{ projectId: "asc" }, { name: "asc" }],
    });
    return rows.map(toStoredSource);
  }

  async listProjectOptions(): Promise<SourceProjectOption[]> {
    const rows = await this.transaction.project.findMany({
      orderBy: [{ organization: { name: "asc" } }, { name: "asc" }],
      select: { id: true, organizationId: true, name: true, organization: { select: { name: true } } },
    });
    return rows.map((row) => ({ id: row.id, organizationId: row.organizationId, name: row.name, organizationName: row.organization.name }));
  }

  async createSource(input: CreateSourceInput): Promise<StoredSource> {
    try {
      const row = await this.transaction.source.create({
        data: {
          organizationId: input.organizationId,
          projectId: input.projectId,
          sourceKey: input.sourceKey,
          transportType: input.transportType,
          sharingPolicy: input.sharingPolicy,
          ...configData(input),
          credentialRef: {
            create: {
              endpointCredentialRefName: input.endpointCredentialRef,
            },
          },
        },
        include: sourceInclude,
      });
      return toStoredSource(row);
    } catch (error) {
      translateWriteError(error);
    }
  }

  async updateSource(input: UpdateSourceInput): Promise<StoredSource | null> {
    try {
      const updated = await this.transaction.source.updateMany({
        where: { organizationId: input.organizationId, projectId: input.projectId, id: input.sourceId, version: input.version },
        data: { ...configData(input), version: { increment: 1 } },
      });
      if (updated.count !== 1) return null;
      if (input.endpointCredentialRef) {
        await this.transaction.sourceCredentialRef.update({
          where: { sourceId: input.sourceId },
          data: { endpointCredentialRefName: input.endpointCredentialRef },
        });
      }
      return this.findSource(input);
    } catch (error) {
      translateWriteError(error);
    }
  }

  async setEnabled(input: SetSourceEnabledInput): Promise<StoredSource | null> {
    const updated = await this.transaction.source.updateMany({
      where: { organizationId: input.organizationId, projectId: input.projectId, id: input.sourceId, version: input.version },
      data: { enabled: input.enabled, version: { increment: 1 } },
    });
    return updated.count === 1 ? this.findSource(input) : null;
  }

  async requestManualRun(input: RequestManualSourceRunInput, requestedBy: string): Promise<{ requestId: string; duplicate: boolean }> {
    const existing = await this.transaction.sourceManualRunRequest.findUnique({
      where: { sourceId_idempotencyKey: { sourceId: input.sourceId, idempotencyKey: input.idempotencyKey } },
      select: { id: true },
    });
    const request = await this.transaction.sourceManualRunRequest.upsert({
      where: { sourceId_idempotencyKey: { sourceId: input.sourceId, idempotencyKey: input.idempotencyKey } },
      create: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        sourceId: input.sourceId,
        idempotencyKey: input.idempotencyKey,
        requestedBy,
      },
      update: {},
      select: { id: true },
    });
    return { requestId: request.id, duplicate: Boolean(existing) };
  }

  async appendAudit(input: SourceRegistryAuditInput): Promise<void> {
    await this.transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorType: "USER",
        actorId: input.actorId,
        action: input.action,
        entityType: "Source",
        entityId: input.sourceId,
        beforeMarker: input.beforeMarker ? markerJson(input.beforeMarker) : Prisma.JsonNull,
        afterMarker: markerJson(input.afterMarker),
        source: "ingestion-core",
        correlationId: input.correlationId,
      },
    });
  }
}
