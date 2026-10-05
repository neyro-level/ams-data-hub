import type { OperationalAlertCandidate, OperationalAlertNotification } from "../domain/operational-alert.ts";
import { toOperationalAlertNotification } from "../domain/operational-alert.ts";

export interface OperationalAlertRepository {
  findScheduledCandidates(now: Date): Promise<OperationalAlertCandidate[]>;
  createNotification(alert: OperationalAlertNotification): Promise<boolean>;
}

export interface OwnerAlertDeliveryPort {
  notifyOwner(alert: OperationalAlertNotification): Promise<void>;
}

export class DisabledOwnerAlertDelivery implements OwnerAlertDeliveryPort {
  async notifyOwner(): Promise<void> {
    // External owner email is deliberately disabled until a real recipient is configured.
  }
}

export function createOperationalAlertService(dependencies: {
  repository: OperationalAlertRepository;
  ownerDelivery?: OwnerAlertDeliveryPort;
}) {
  const ownerDelivery = dependencies.ownerDelivery ?? new DisabledOwnerAlertDelivery();

  async function publish(candidates: OperationalAlertCandidate[]) {
    const created: OperationalAlertNotification[] = [];
    for (const candidate of candidates) {
      const alert = toOperationalAlertNotification(candidate);
      if (await dependencies.repository.createNotification(alert)) created.push(alert);
    }
    for (const alert of created) await ownerDelivery.notifyOwner(alert);
    return { evaluated: candidates.length, created: created.length, alerts: created };
  }

  async function scan(now = new Date()) {
    return publish(await dependencies.repository.findScheduledCandidates(now));
  }

  async function signal(candidate: OperationalAlertCandidate) {
    return publish([candidate]);
  }

  return { scan, signal };
}
