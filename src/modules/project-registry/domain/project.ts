import { z } from "zod";

export const PROJECT_STATUSES = ["ACTIVE", "PLANNED", "DISABLED"] as const;
export const projectStatusSchema = z.enum(PROJECT_STATUSES);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

const idSchema = z.string().trim().min(1).max(128);
const projectNameSchema = z.string().trim().min(1, "Укажите название проекта").max(160);

export const createProjectInputSchema = z.object({
  organizationId: idSchema,
  slug: z
    .string()
    .trim()
    .min(1, "Укажите адрес проекта в кабинете")
    .max(80)
    .regex(/^[a-z0-9-]+$/, "Используйте строчные латинские буквы, цифры и дефис"),
  name: projectNameSchema,
  status: projectStatusSchema,
  thresholdProfileId: idSchema,
  clusterProfileId: idSchema,
});

export const changeProjectStatusInputSchema = z.object({
  organizationId: idSchema,
  projectId: idSchema,
  version: z.number().int().positive(),
  status: projectStatusSchema,
});

export const updateProjectSettingsInputSchema = z.object({
  organizationId: idSchema,
  projectId: idSchema,
  version: z.number().int().positive(),
  name: projectNameSchema,
  thresholdProfileId: idSchema,
  clusterProfileId: idSchema,
});

export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;
export type ChangeProjectStatusInput = z.infer<typeof changeProjectStatusInputSchema>;
export type UpdateProjectSettingsInput = z.infer<typeof updateProjectSettingsInputSchema>;

export type ProjectErrorCode =
  | "PROJECT_ACCESS_DENIED"
  | "PROJECT_NOT_FOUND_OR_FORBIDDEN"
  | "PROJECT_STALE"
  | "PROJECT_SLUG_CONFLICT"
  | "PROJECT_REFERENCE_INVALID";

export class ProjectError extends Error {
  constructor(public readonly code: ProjectErrorCode) {
    super(code);
    this.name = "ProjectError";
  }
}

export function nextProjectVersion(version: number): number {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new ProjectError("PROJECT_STALE");
  }
  return version + 1;
}
