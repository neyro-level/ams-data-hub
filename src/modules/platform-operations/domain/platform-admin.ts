import { z } from "zod";

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Используйте строчные латинские буквы, цифры и дефис");
const identifierSchema = z.string().trim().min(1).max(128);

export const requestProjectSyncInputSchema = z.object({
  projectSlug: slugSchema,
  idempotencyKey: identifierSchema,
});

export type RequestProjectSyncInput = z.infer<typeof requestProjectSyncInputSchema>;

export interface OperationListItem {
  id: string;
  kind: "sync-run" | "outbox-event";
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
      | "PROJECT_SYNC_NOT_FOUND"
      | "PROJECT_SYNC_INVALID_SCOPE",
  ) {
    super(code);
    this.name = "PlatformOperationsAdminError";
  }
}
