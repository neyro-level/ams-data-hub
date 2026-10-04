import type { SourceSchedulePolicy } from "../contracts.ts";

export function isSourceEligibleForAutomaticRun(input: {
  enabled: boolean;
  schedulePolicy: SourceSchedulePolicy;
}): boolean {
  return input.enabled && input.schedulePolicy.mode === "SCHEDULED";
}
