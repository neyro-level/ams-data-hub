export type OperationalAlertKind =
  | "SOURCE_OVERDUE"
  | "IMPORT_SUSPICIOUS"
  | "IMPORT_CRITICAL"
  | "ACK_STALE"
  | "WORKER_FAILED"
  | "BACKUP_FAILED";

export interface OperationalAlertCandidate {
  kind: OperationalAlertKind;
  organizationId: string | null;
  projectId: string | null;
  sourceType: string;
  sourceId: string;
  occurredAt: Date;
  safeErrorCode?: string | null;
}

export interface OperationalAlertNotification extends OperationalAlertCandidate {
  category: "SYSTEM" | "PROJECT" | "QUEUE";
  severity: "WARNING" | "ERROR";
  visibility: "PLATFORM_ADMIN_ONLY";
  title: string;
  message: string;
  route: "/admin/fleet/";
  dedupKey: string;
}

const presentation: Record<OperationalAlertKind, Pick<OperationalAlertNotification, "category" | "severity" | "title"> & { message: (safeErrorCode: string | null) => string }> = {
  SOURCE_OVERDUE: { category: "PROJECT", severity: "WARNING", title: "Источник просрочен", message: () => "Источник не имеет успешного обновления более 24 часов." },
  IMPORT_SUSPICIOUS: { category: "PROJECT", severity: "WARNING", title: "Импорт требует решения", message: () => "Импорт остановлен как SUSPICIOUS и ожидает ручного решения." },
  IMPORT_CRITICAL: { category: "PROJECT", severity: "ERROR", title: "Критичный импорт отклонён", message: (code) => `Импорт отклонён политикой безопасности. Код: ${code ?? "IMPORT_CRITICAL"}.` },
  ACK_STALE: { category: "PROJECT", severity: "WARNING", title: "ACK просрочен", message: () => "Проект не подтвердил применение snapshot более 24 часов." },
  WORKER_FAILED: { category: "QUEUE", severity: "ERROR", title: "Worker недоступен", message: (code) => `Heartbeat worker просрочен. Код: ${code ?? "WORKER_HEARTBEAT_STALE"}.` },
  BACKUP_FAILED: { category: "SYSTEM", severity: "ERROR", title: "Backup завершился ошибкой", message: (code) => `Резервная копия не подтверждена. Код: ${code ?? "BACKUP_FAILED"}.` },
};

function dayBucket(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function toOperationalAlertNotification(candidate: OperationalAlertCandidate): OperationalAlertNotification {
  const view = presentation[candidate.kind];
  return {
    ...candidate,
    safeErrorCode: candidate.safeErrorCode ?? null,
    ...view,
    visibility: "PLATFORM_ADMIN_ONLY",
    message: view.message(candidate.safeErrorCode ?? null),
    route: "/admin/fleet/",
    dedupKey: `operations-alert:${candidate.kind}:${candidate.sourceType}:${candidate.sourceId}:${dayBucket(candidate.occurredAt)}`,
  };
}
