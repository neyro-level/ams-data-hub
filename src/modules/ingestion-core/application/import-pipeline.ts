import { createHash } from "node:crypto";

export type ImportPipelineStage =
  | "SAFE_INTAKE"
  | "RAW_ARTIFACT"
  | "PARSE"
  | "VALIDATE"
  | "NORMALIZE"
  | "IDENTITY_RESOLUTION"
  | "SAFETY_ANALYSIS"
  | "STAGING"
  | "MUTATION_PLAN"
  | "DATABASE_APPLY"
  | "SNAPSHOT_TRIGGER";

export interface SourceImportTarget {
  organizationId: string;
  projectId: string;
  sourceId: string;
}

export interface RawArtifactReceipt {
  storageKey: string;
  rawArtifactHash: string;
  byteCount: number;
}

export interface StagingReceipt {
  stagingId: string;
  entityCount: number;
}

export interface MutationPlan {
  createCount: number;
  updateCount: number;
  deactivateCount: number;
  payload: unknown;
}

export interface GoodRevisionReceipt {
  revisionId: string;
  sequence: number;
}

export interface ImportPipelineDependencies<TRaw, TParsed, TNormalized, TResolved> {
  safeIntake: { acquire(target: SourceImportTarget): Promise<TRaw> };
  rawArtifactStore: { put(target: SourceImportTarget, raw: TRaw): Promise<RawArtifactReceipt> };
  parser: { parse(raw: TRaw, target: SourceImportTarget): Promise<TParsed> };
  validator: { validate(parsed: TParsed, target: SourceImportTarget): Promise<void> };
  normalizer: { normalize(parsed: TParsed, target: SourceImportTarget): Promise<TNormalized> };
  identityResolver: { resolve(normalized: TNormalized, target: SourceImportTarget): Promise<TResolved> };
  safetyAnalyzer: { analyze(resolved: TResolved, target: SourceImportTarget): Promise<void> };
  stagingStore: { write(resolved: TResolved, target: SourceImportTarget): Promise<StagingReceipt> };
  mutationPlanner: { plan(staging: StagingReceipt, target: SourceImportTarget): Promise<MutationPlan> };
  repository: {
    recordAttemptStarted(target: SourceImportTarget): Promise<void>;
    recordFailure(target: SourceImportTarget, stage: ImportPipelineStage, code: string): Promise<void>;
    applyGoodRevision(input: SourceImportTarget & {
      rawArtifact: RawArtifactReceipt;
      normalizedContentHash: string;
      staging: StagingReceipt;
      mutationPlan: MutationPlan;
    }): Promise<GoodRevisionReceipt>;
  };
  snapshotTrigger: { request(target: SourceImportTarget, revision: GoodRevisionReceipt): Promise<void> };
}

export type SourceImportResult =
  | {
    state: "GOOD";
    sourceId: string;
    revisionId: string;
    sequence: number;
    rawArtifactHash: string;
    normalizedContentHash: string;
    snapshotTriggered: boolean;
  }
  | { state: "FAILED"; sourceId: string; failedStage: ImportPipelineStage; code: string };

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function normalizedContentHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function failureCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{2,100}$/u.test(error.message)) return error.message;
  return "IMPORT_PIPELINE_FAILED";
}

export async function runSourceImport<TRaw, TParsed, TNormalized, TResolved>(
  target: SourceImportTarget,
  dependencies: ImportPipelineDependencies<TRaw, TParsed, TNormalized, TResolved>,
): Promise<SourceImportResult> {
  let stage: ImportPipelineStage = "SAFE_INTAKE";
  try {
    await dependencies.repository.recordAttemptStarted(target);
    const raw = await dependencies.safeIntake.acquire(target);
    stage = "RAW_ARTIFACT";
    const rawArtifact = await dependencies.rawArtifactStore.put(target, raw);
    stage = "PARSE";
    const parsed = await dependencies.parser.parse(raw, target);
    stage = "VALIDATE";
    await dependencies.validator.validate(parsed, target);
    stage = "NORMALIZE";
    const normalized = await dependencies.normalizer.normalize(parsed, target);
    const semanticHash = normalizedContentHash(normalized);
    stage = "IDENTITY_RESOLUTION";
    const resolved = await dependencies.identityResolver.resolve(normalized, target);
    stage = "SAFETY_ANALYSIS";
    await dependencies.safetyAnalyzer.analyze(resolved, target);
    stage = "STAGING";
    const staging = await dependencies.stagingStore.write(resolved, target);
    stage = "MUTATION_PLAN";
    const mutationPlan = await dependencies.mutationPlanner.plan(staging, target);
    stage = "DATABASE_APPLY";
    const revision = await dependencies.repository.applyGoodRevision({
      ...target,
      rawArtifact,
      normalizedContentHash: semanticHash,
      staging,
      mutationPlan,
    });
    stage = "SNAPSHOT_TRIGGER";
    let snapshotTriggered = true;
    try {
      await dependencies.snapshotTrigger.request(target, revision);
    } catch {
      snapshotTriggered = false;
    }
    return {
      state: "GOOD",
      sourceId: target.sourceId,
      revisionId: revision.revisionId,
      sequence: revision.sequence,
      rawArtifactHash: rawArtifact.rawArtifactHash,
      normalizedContentHash: semanticHash,
      snapshotTriggered,
    };
  } catch (error) {
    const code = failureCode(error);
    try {
      await dependencies.repository.recordFailure(target, stage, code);
    } catch {
      // Failure evidence is best-effort here; it must never let one Source reject the batch.
    }
    return { state: "FAILED", sourceId: target.sourceId, failedStage: stage, code };
  }
}

export async function runIndependentSourceImports<TRaw, TParsed, TNormalized, TResolved>(
  targets: readonly SourceImportTarget[],
  createDependencies: (target: SourceImportTarget) => ImportPipelineDependencies<TRaw, TParsed, TNormalized, TResolved>,
): Promise<SourceImportResult[]> {
  return Promise.all(targets.map((target) => runSourceImport(target, createDependencies(target))));
}
