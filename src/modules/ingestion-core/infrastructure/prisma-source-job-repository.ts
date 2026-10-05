import type { ProjectJobPrincipal } from "../../../platform/authorization/principal.ts";
import type { DatabaseTransaction } from "../../../platform/database/transaction.ts";
import { sourceSchedulePolicySchema } from "../contracts.ts";
import type {
  SourceJobExecutionContext,
  SourceJobRecord,
  SourceJobRepository,
} from "../application/ports/source-job-repository.ts";

const sourceJobSelect = {
  id: true,
  organizationId: true,
  projectId: true,
  enabled: true,
  schedulePolicy: true,
  lastAttemptAt: true,
  updatedAt: true,
  project: { select: { serviceState: true } },
} as const;

function toRecord(row: {
  id: string;
  organizationId: string;
  projectId: string;
  enabled: boolean;
  schedulePolicy: unknown;
  lastAttemptAt: Date | null;
  updatedAt: Date;
}): SourceJobRecord {
  return {
    sourceId: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    enabled: row.enabled,
    schedulePolicy: sourceSchedulePolicySchema.parse(row.schedulePolicy),
    lastAttemptAt: row.lastAttemptAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaSourceJobRepository implements SourceJobRepository {
  constructor(private readonly transaction: DatabaseTransaction) {}

  async listSchedulingSources(): Promise<SourceJobRecord[]> {
    const rows = await this.transaction.source.findMany({
      select: sourceJobSelect,
      orderBy: { id: "asc" },
    });
    return rows.map(toRecord);
  }

  async loadExecutionContext(
    principal: ProjectJobPrincipal,
    sourceId: string,
  ): Promise<SourceJobExecutionContext | null> {
    const row = await this.transaction.source.findFirst({
      where: {
        id: sourceId,
        organizationId: principal.organizationId,
        projectId: principal.projectId,
      },
      select: sourceJobSelect,
    });
    return row ? { ...toRecord(row), serviceState: row.project.serviceState } : null;
  }
}
