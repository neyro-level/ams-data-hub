import { REDACTED_VALUE } from "../../../platform/security/sensitive-redaction.ts";
import { createSecretRefStatus, defineSecretRef } from "../../../platform/security/secret-ref.ts";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { runInPrincipalDatabaseTransaction, type DatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { SourceAdminData, SourceAdminDto } from "../contracts.ts";
import type { SourceRegistryRepository, StoredSource } from "./ports/source-registry-repository.ts";
import { requireSourceRegistryAdmin } from "./source-registry-authorization.ts";

function toAdminDto(source: StoredSource): SourceAdminDto {
  const credential = createSecretRefStatus(defineSecretRef(source.endpointCredentialRefName));
  return {
    sourceId: source.sourceId,
    organizationId: source.organizationId,
    projectId: source.projectId,
    sourceKey: source.sourceKey,
    name: source.name,
    adapterKey: source.adapterKey,
    adapterVersion: source.adapterVersion,
    profileKey: source.profileKey,
    profileVersion: source.profileVersion,
    datasetType: source.datasetType,
    transportType: source.transportType,
    sharingPolicy: source.sharingPolicy,
    schedulePolicy: source.schedulePolicy,
    safetyPolicyId: source.safetyPolicyId,
    enabled: source.enabled,
    lastAttemptAt: source.lastAttemptAt,
    lastSuccessAt: source.lastSuccessAt,
    lastGoodRevisionId: source.lastGoodRevisionId,
    expectedNamespace: source.expectedNamespace,
    expectedProducer: source.expectedProducer,
    credential: { configured: credential.configured, displayValue: REDACTED_VALUE },
    pendingManualRuns: source.pendingManualRuns,
    version: source.version,
    updatedAt: source.updatedAt,
  };
}

export function createSourceRegistryQueries(dependencies: {
  createRepository(transaction: DatabaseTransaction): SourceRegistryRepository;
}) {
  return {
    async listSourcesForAdmin(principal: PrincipalContext, filter: { organizationId?: string; projectId?: string } = {}): Promise<SourceAdminDto[]> {
      requireSourceRegistryAdmin(principal);
      return runInPrincipalDatabaseTransaction(principal, async (transaction) => {
        const rows = await dependencies.createRepository(transaction).listSources(filter.organizationId, filter.projectId);
        return rows.map(toAdminDto);
      });
    },
    async getSourceAdminData(principal: PrincipalContext): Promise<SourceAdminData> {
      requireSourceRegistryAdmin(principal);
      return runInPrincipalDatabaseTransaction(principal, async (transaction) => {
        const repository = dependencies.createRepository(transaction);
        const [sources, projects] = await Promise.all([repository.listSources(), repository.listProjectOptions()]);
        return { sources: sources.map(toAdminDto), projects };
      });
    },
  };
}
