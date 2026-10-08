import type { FleetOperationalRequestView } from "../contracts.ts";

const completedActions: Record<string, string> = {
  SNAPSHOT_BUILD: "Snapshot собран; этот запрос не выполняет публикацию",
  SNAPSHOT_PUBLISH: "Snapshot опубликован",
  SNAPSHOT_ROLLBACK: "Rollback опубликован новым sequence",
  ACK_ROTATE: "Фаза ротации ACK выполнена",
  SUSPICIOUS_APPROVE: "Ревизия применена как GOOD",
  SUSPICIOUS_REJECT: "Ревизия отклонена",
};

/** Request acceptance is never described as completed domain work. */
export function operationalRequestStateLabel(request: Pick<FleetOperationalRequestView, "action" | "status">): string {
  switch (request.status) {
    case "REQUESTED": return "Запрос принят — ожидает исполнителя";
    case "RUNNING": return "Выполняется — результат ещё не подтверждён";
    case "FAILED": return "Ошибка — операция не завершена";
    case "SUCCEEDED": return completedActions[request.action] ?? "Операция выполнена";
  }
}
