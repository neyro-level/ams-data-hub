import { z } from "zod";

const identifierSchema = z.string().trim().min(1).max(128);

export const requestMaintenanceInputSchema = z.object({
  idempotencyKey: identifierSchema,
});

export type RequestMaintenanceInput = z.infer<typeof requestMaintenanceInputSchema>;

export interface OperationListItem {
  id: string;
  kind: "outbox-event";
  primary: string;
  secondary: string;
  status: string;
  updatedAt: string;
}

export interface OperationListResult {
  items: OperationListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export class PlatformOperationsAdminError extends Error {
  constructor(
    public readonly code:
      | "PLATFORM_OPERATIONS_ADMIN_ACCESS_DENIED"
      | "MAINTENANCE_REQUEST_INVALID_SCOPE",
  ) {
    super(code);
    this.name = "PlatformOperationsAdminError";
  }
}
