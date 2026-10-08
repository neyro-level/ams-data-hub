import type { FleetOperationalRequestView, FleetOperationalResultView } from "../contracts.ts";
import { operationalResultSchema } from "../operational-result-contracts.ts";

/** SQL caps the raw JSON before transfer; only validated action-specific
 * identifiers/counters are copied. No hash, lease, token or private proof. */
export function projectOperationalResult(action: string, status: string, raw: unknown): FleetOperationalResultView | null {
  if (status !== "SUCCEEDED") return null;
  const parsed = operationalResultSchema.safeParse(raw);
  if (!parsed.success || parsed.data.action !== action) return null;
  const result = parsed.data;
  switch (result.action) {
    case "SNAPSHOT_BUILD": case "SNAPSHOT_PUBLISH": return { action: result.action, buildInputId: result.buildInputId, publishSequence: result.publishSequence };
    case "SNAPSHOT_ROLLBACK": return { action: result.action, sourcePublishSequence: result.sourcePublishSequence, publishSequence: result.publishSequence };
    case "ACK_ROTATE": return { action: result.action, phase: result.phase, credentialVersion: result.credentialVersion };
    case "SUSPICIOUS_APPROVE": case "SUSPICIOUS_REJECT": return { action: result.action, sourceRevisionId: result.sourceRevisionId };
  }
}

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
