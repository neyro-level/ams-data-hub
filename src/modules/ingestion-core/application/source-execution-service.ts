import "server-only";

import { randomUUID } from "node:crypto";
import type { ProjectJobPrincipal } from "../../../platform/authorization/principal.ts";
import { defineSecretRef, type SecretRef } from "../../../platform/security/secret-ref.ts";
import { type SourceAdapterDescriptor, type SourceProfileDescriptor } from "../domain/adapter-profile-registry.ts";
import { resolveExecutableSourceAdapter } from "../domain/executable-adapter-registry.ts";
import { BOOTSTRAP_SOURCE_SAFETY_POLICY, type SourceSafetyPolicy } from "../domain/safety-engine.ts";
import type { StoredSource } from "./ports/source-registry-repository.ts";
import type { SourceImportResult, SourceImportTarget } from "./import-pipeline.ts";

const SAFE_FAILURE_CODES = new Set([
  "SOURCE_EXECUTION_TARGET_INVALID", "SOURCE_EXECUTION_NOT_FOUND", "SOURCE_EXECUTION_SCOPE_MISMATCH",
  "SOURCE_EXECUTION_DISABLED", "SOURCE_EXECUTION_PROJECT_BLOCKED", "SOURCE_EXECUTION_POLICY_MISSING",
  "SOURCE_EXECUTION_LAST_GOOD_MISSING", "SOURCE_EXECUTION_LAST_GOOD_INVALID",
  "SOURCE_EXECUTION_LEASE_LOST",
  "SOURCE_EXECUTION_ABORTED",
  "SOURCE_REGISTRY_ADAPTER_UNKNOWN", "SOURCE_REGISTRY_PROFILE_UNKNOWN", "SOURCE_REGISTRY_PROFILE_INCOMPATIBLE",
]);
const IMPORT_FAILURE_CODES = new Set([
  ...SAFE_FAILURE_CODES, "SOURCE_EXECUTION_FAILED", "IMPORT_PIPELINE_FAILED", "YRL_XML_MALFORMED",
  "IMPORT_REQUIRES_APPROVAL", "IMPORT_REJECTED_BY_SAFETY_POLICY", "IMPORT_APPROVAL_EVIDENCE_INVALID",
  "RAW_ARTIFACT_CLEANUP_FAILED", "SOURCE_EXECUTION_STALE",
  "SOURCE_DUPLICATE_EXTERNAL_ID", "SOURCE_RECORD_INVALID", "SOURCE_RECORD_TOO_LARGE",
  "SOURCE_ENDPOINT_CREDENTIAL_UNAVAILABLE", "SOURCE_ENDPOINT_INTAKE_FAILED", "SOURCE_EXECUTION_POLICY_STALE",
  "SOURCE_EXECUTION_IDENTITY_STALE", "SOURCE_REVISION_STAGING_CLOSED",
  "SOURCE_REVISION_SAFETY_INVALID",
]);
const IMPORT_STAGES = new Set([
  "SAFE_INTAKE", "RAW_ARTIFACT", "PARSE", "VALIDATE", "NORMALIZE", "IDENTITY_RESOLUTION",
  "SAFETY_ANALYSIS", "STAGING", "MUTATION_PLAN", "DATABASE_APPLY", "SNAPSHOT_TRIGGER",
]);

function safeResult(result: SourceImportResult, sourceId: string): SourceImportResult {
  if (result?.sourceId !== sourceId) throw new Error("SOURCE_EXECUTION_SCOPE_MISMATCH");
  if (result.state === "FAILED" && IMPORT_STAGES.has(result.failedStage)) {
    return { state: "FAILED", sourceId, failedStage: result.failedStage,
      code: IMPORT_FAILURE_CODES.has(result.code) ? result.code : "SOURCE_EXECUTION_FAILED" };
  }
  if (result.state === "GOOD" && /^[A-Za-z0-9_-]{1,128}$/u.test(result.revisionId)
    && Number.isSafeInteger(result.sequence) && result.sequence > 0
    && /^[a-f0-9]{64}$/u.test(result.rawArtifactHash) && /^[a-f0-9]{64}$/u.test(result.normalizedContentHash)
    && typeof result.snapshotTriggered === "boolean") {
    return { state: "GOOD", sourceId, revisionId: result.revisionId, sequence: result.sequence,
      rawArtifactHash: result.rawArtifactHash, normalizedContentHash: result.normalizedContentHash,
      snapshotTriggered: result.snapshotTriggered };
  }
  throw new Error("SOURCE_EXECUTION_FAILED");
}

export interface SourceExecutionState {
  source: StoredSource;
  serviceState: string;
  safetyPolicy: SourceSafetyPolicy | null;
  lastGood: { revisionId: string; recordCount: number } | null;
}

export interface ResolvedSourceExecution {
  target: SourceImportTarget;
  principal: ProjectJobPrincipal;
  source: StoredSource;
  endpointReference: SecretRef;
  adapter: SourceAdapterDescriptor;
  profile: SourceProfileDescriptor;
  executableAdapter: ReturnType<typeof resolveExecutableSourceAdapter>;
  safetyPolicy: SourceSafetyPolicy;
  lastGood: SourceExecutionState["lastGood"];
}

/** One application entrypoint. Concrete persistence/intake composition is bound
 * by the server runtime, never by a queue payload or an admin request. */
export class SourceExecutionService {
  constructor(private readonly dependencies: {
    load(principal: ProjectJobPrincipal, sourceId: string): Promise<SourceExecutionState | null>;
    run(context: ResolvedSourceExecution): Promise<SourceImportResult>;
  }) {}

  async run(target: SourceImportTarget): Promise<SourceImportResult> {
    try {
      if (![target.organizationId, target.projectId, target.sourceId].every((id) =>
        typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(id))) {
        throw new Error("SOURCE_EXECUTION_TARGET_INVALID");
      }
      const principal: ProjectJobPrincipal = {
        kind: "project-job", jobName: "source-import", organizationId: target.organizationId,
        projectId: target.projectId, correlationId: randomUUID(),
      };
      const state = await this.dependencies.load(principal, target.sourceId);
      if (!state) throw new Error("SOURCE_EXECUTION_NOT_FOUND");
      const { source } = state;
      if (source.organizationId !== target.organizationId || source.projectId !== target.projectId || source.sourceId !== target.sourceId) {
        throw new Error("SOURCE_EXECUTION_SCOPE_MISMATCH");
      }
      if (!source.enabled) throw new Error("SOURCE_EXECUTION_DISABLED");
      if (state.serviceState !== "ACTIVE") throw new Error("SOURCE_EXECUTION_PROJECT_BLOCKED");
      const executableAdapter = resolveExecutableSourceAdapter(source);
      const { adapter, profile } = executableAdapter;
      if (source.safetyPolicyId !== null && state.safetyPolicy === null) throw new Error("SOURCE_EXECUTION_POLICY_MISSING");
      if (source.lastGoodRevisionId !== (state.lastGood?.revisionId ?? null)) throw new Error("SOURCE_EXECUTION_LAST_GOOD_MISSING");
      if (state.lastGood && (!Number.isInteger(state.lastGood.recordCount) || state.lastGood.recordCount < 0)) {
        throw new Error("SOURCE_EXECUTION_LAST_GOOD_INVALID");
      }
      const safetyPolicy = state.safetyPolicy ?? profile.configuration?.safetyPolicy ?? BOOTSTRAP_SOURCE_SAFETY_POLICY;
      const endpointReference = defineSecretRef(source.endpointCredentialRefName);
      return safeResult(await this.dependencies.run({ target: { ...target }, principal, source, endpointReference, adapter, profile, executableAdapter, safetyPolicy, lastGood: state.lastGood }), target.sourceId);
    } catch (error) {
      // No cause, stack, URL, ref name or arbitrary repository error enters a job result.
      const code = error instanceof Error && SAFE_FAILURE_CODES.has(error.message)
        ? error.message : "SOURCE_EXECUTION_FAILED";
      const sourceId = typeof target.sourceId === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(target.sourceId)
        ? target.sourceId : "INVALID_SOURCE";
      return { state: "FAILED", sourceId, failedStage: "SAFE_INTAKE", code };
    }
  }
}
