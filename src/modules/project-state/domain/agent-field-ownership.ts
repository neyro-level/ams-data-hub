export const AGENT_FEED_OWNED_FIELDS = ["fullName", "workPhone", "workEmail", "feedPhotoMediaId"] as const;
export const AGENT_MANUAL_OWNED_FIELDS = [
  "role", "position", "bio", "specializations", "photoMediaId", "showOnSite", "sortOrder", "slug",
] as const;

export const AGENT_MAX_BULK_CHANGE_PERCENT = 30;

export function isSuspiciousAgentBulkChange(total: number, affected: number): boolean {
  if (total <= 0 || affected <= 0) return false;
  return affected / total > AGENT_MAX_BULK_CHANGE_PERCENT / 100;
}
