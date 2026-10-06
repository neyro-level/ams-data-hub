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
} as const;

const MAX_SCHEDULING_SOURCES = 10_000;

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
      take: MAX_SCHEDULING_SOURCES + 1,
    });
    if (rows.length > MAX_SCHEDULING_SOURCES) throw new Error("SOURCE_SCHEDULE_REGISTRY_LIMIT");
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
      select: { ...sourceJobSelect, project: { select: { serviceState: true } } },
    });
    return row ? { ...toRecord(row), serviceState: row.project.serviceState } : null;
  }
}
