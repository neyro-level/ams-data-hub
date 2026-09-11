import { z } from "zod";
import type { PlatformAdminListQuery } from "../platform-admin/index.ts";

const identifierSchema = z.string().trim().min(1).max(128);
const positiveVersionSchema = z.number().int().positive();

export const projectSlugSchema = z
  .string()
  .trim()
  .min(1, "Укажите адрес в кабинете")
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Используйте строчные латинские буквы, цифры и дефис");

export const projectStatusSchema = z.enum(["ACTIVE", "PLANNED", "DISABLED"]);

export const createProjectInputSchema = z.object({
  organizationId: identifierSchema,
  slug: projectSlugSchema,
  name: z.string().trim().min(2, "Укажите название проекта").max(160),
  description: z.string().trim().max(500).optional().default(""),
  status: projectStatusSchema.default("ACTIVE"),
});

export const updateProjectInputSchema = createProjectInputSchema.extend({
  projectId: identifierSchema,
  version: positiveVersionSchema,
});

export type ProjectStatus = z.infer<typeof projectStatusSchema>;
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;

export interface ProjectListItem {
  id: string;
  organizationId: string;
  organizationName: string;
  slug: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  version: number;
  updatedAt: string;
}

export interface ProjectListResult {
  items: ProjectListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ProjectFormOptions {
  organizations: Array<{ id: string; name: string }>;
}

export type ProjectListQuery = PlatformAdminListQuery;
