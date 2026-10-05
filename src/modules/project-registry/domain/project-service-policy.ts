import type { ProjectServiceState } from "../contracts.ts";

export interface ProjectServicePolicy {
  canIngest: boolean;
  canPublish: boolean;
  canReadPublished: true;
}

export function projectServicePolicy(serviceState: ProjectServiceState): ProjectServicePolicy {
  return serviceState === "ACTIVE"
    ? { canIngest: true, canPublish: true, canReadPublished: true }
    : { canIngest: false, canPublish: false, canReadPublished: true };
}

export function assertProjectOperationAllowed(
  serviceState: ProjectServiceState,
  operation: "INGEST" | "PUBLISH",
): void {
  const policy = projectServicePolicy(serviceState);
  if ((operation === "INGEST" && !policy.canIngest) || (operation === "PUBLISH" && !policy.canPublish)) {
    throw new Error(`PROJECT_SERVICE_SUSPENDED:${operation}`);
  }
}
