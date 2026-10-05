import { runInPrincipalDatabaseTransaction } from "../../../platform/database/transaction.ts";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { defineCommand } from "../../../platform/commands/define-command.ts";
import { ReliabilityService } from "../application/reliability-service.ts";
import { PrismaReliabilityRepository } from "./prisma-reliability-repository.ts";
import { createDataSafetyService } from "../application/data-safety-service.ts";
import { PrismaDataSafetyRepository } from "./prisma-data-safety-repository.ts";
import {
  PlatformOperationsAdminError,
  requestMaintenanceInputSchema,
  type OperationListResult,
  type RequestMaintenanceInput,
} from "../domain/platform-admin.ts";
import type { PlatformAdminListQuery } from "../../platform-admin/contracts.ts";

const operationStatusLabels: Record<string, string> = {
  PENDING: "Ожидает запуска",
  PROCESSING: "Выполняется",
  PROCESSED: "Завершено",
  FAILED: "Ошибка",
  DEAD_LETTER: "Остановлено после ошибок",
};

const topicLabels: Record<string, string> = {
  "platform.maintenance.requested": "Служебное обслуживание платформы",
  "outbox.retention.requested": "Очистка завершённых заданий",
};

function requirePlatformAdmin(principal: PrincipalContext) {
  if (principal.kind !== "platform-admin") {
    throw new PlatformOperationsAdminError("PLATFORM_OPERATIONS_ADMIN_ACCESS_DENIED");
  }
  return {
    actorId: principal.userId,
    correlationId: principal.correlationId,
  };
}

export async function listOperations(
  principal: PrincipalContext,
  query: PlatformAdminListQuery,
): Promise<OperationListResult> {
  requirePlatformAdmin(principal);
  const outboxEvents = await runInPrincipalDatabaseTransaction(principal, (transaction) =>
    transaction.outboxEvent.findMany({
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: {
        id: true,
        topic: true,
        status: true,
        attempts: true,
        lastErrorCode: true,
        updatedAt: true,
      },
    }),
  );

  const search = query.search.toLocaleLowerCase("ru");
  const rows = outboxEvents
    .map((item) => ({
      id: item.id,
      kind: "outbox-event" as const,
      primary: topicLabels[item.topic] ?? "Служебное задание",
      secondary: `Попыток запуска: ${item.attempts}${item.lastErrorCode ? " · требуется внимание" : ""}`,
      status: operationStatusLabels[item.status] ?? "Состояние уточняется",
      updatedAt: item.updatedAt.toISOString(),
    }))
    .filter((item) =>
      !search
        || `${item.primary} ${item.secondary} ${item.status}`
          .toLocaleLowerCase("ru")
          .includes(search),
    )
    .sort((left, right) => {
      const field = query.sort === "name" ? "primary" : query.sort === "status" ? "status" : "updatedAt";
      const comparison = left[field].localeCompare(right[field], "ru");
      return query.direction === "asc" ? comparison : -comparison;
    });

  const start = (query.page - 1) * query.pageSize;
  return {
    items: rows.slice(start, start + query.pageSize),
    total: rows.length,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function requestMaintenance(
  principal: PrincipalContext,
  rawInput: RequestMaintenanceInput,
) {
  return enqueueMaintenance(principal, rawInput);
}

const dataSafetyService = createDataSafetyService({
  createRepository: (transaction) => new PrismaDataSafetyRepository(transaction),
});

export const freezeMutatingJobs = dataSafetyService.freezeMutatingJobs;
export const unfreezeMutatingJobs = dataSafetyService.unfreezeMutatingJobs;

const enqueueMaintenance = defineCommand({
  name: "platform-operations.maintenance.request",
  input: requestMaintenanceInputSchema,
  authorize: (principal: PrincipalContext) => {
    requirePlatformAdmin(principal);
  },
  execute: async ({ principal, input, transaction }) => {
    const actor = requirePlatformAdmin(principal);
    const reliabilityService = new ReliabilityService(
      new PrismaReliabilityRepository(transaction),
    );
    const result = await reliabilityService.enqueue({
      organizationId: null,
      organizationScope: "platform",
      idempotencyScope: "platform-admin.maintenance",
      idempotencyKey: input.idempotencyKey,
      topic: "platform.maintenance.requested",
      payload: { requestedBy: actor.actorId },
      actorType: "USER",
      actorId: actor.actorId,
      action: "platform.maintenance.request",
      entityType: "Platform",
      entityId: "platform",
      source: "platform-admin",
      correlationId: actor.correlationId,
    });
    return { outboxEventId: result.outboxEventId, duplicate: result.duplicate };
  },
});
