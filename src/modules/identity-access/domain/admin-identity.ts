import { z } from "zod";
import type { TenantRole } from "../../../platform/authorization/principal.ts";

const identifierSchema = z.string().trim().min(1).max(128);
const positiveVersionSchema = z.number().int().positive();
const slugSchema = z
  .string()
  .trim()
  .min(1, "Укажите адрес в кабинете")
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Используйте строчные латинские буквы, цифры и дефис");
const organizationNameSchema = z
  .string()
  .trim()
  .min(2, "Укажите название организации")
  .max(160);

const trackedQuerySchema = z.string().trim().min(2).max(240);

const onboardingSiteSchema = z.object({
  name: z.string().trim().min(2, "Укажите название сайта").max(160),
  slug: slugSchema,
  url: z.url("Укажите корректный HTTPS-адрес").refine((value) => value.startsWith("https://"), "Адрес должен начинаться с https://"),
  timezone: z.string().trim().min(1, "Укажите часовой пояс").max(80),
  regionName: z.string().trim().min(2, "Выберите регион продвижения").max(160),
  regionCountryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
  yandexRegionKey: z.number().int().positive(),
  googleRegionKey: z.number().int().positive(),
  queries: z.array(trackedQuerySchema).min(20, "Добавьте минимум 20 запросов").max(100, "Можно добавить не более 100 запросов"),
}).superRefine((value, context) => {
  const normalized = value.queries.map((query) => query.toLocaleLowerCase("ru-RU").replace(/\s+/g, " ").trim());
  if (new Set(normalized).size !== normalized.length) {
    context.addIssue({ code: "custom", path: ["queries"], message: "Удалите повторяющиеся запросы" });
  }
  try {
    Intl.DateTimeFormat("ru-RU", { timeZone: value.timezone }).format(new Date());
  } catch {
    context.addIssue({ code: "custom", path: ["timezone"], message: "Укажите корректный часовой пояс, например Europe/Moscow" });
  }
});

export const tenantRoleSchema = z.enum(["ORG_OWNER", "ORG_MEMBER", "VIEWER"]);

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,30}$/, "Логин: 3–30 строчных латинских букв, цифр или подчёркиваний");

export const fixedPasswordSchema = z
  .string()
  .regex(/^[\x21-\x7e]{8}$/, "Пароль должен содержать ровно 8 печатных символов без пробелов");

export const provisionClientInputSchema = z.object({
  organizationName: organizationNameSchema,
  organizationSlug: slugSchema,
  projectName: z.string().trim().min(1, "Укажите название проекта").max(160),
  projectSlug: slugSchema,
  thresholdProfileId: identifierSchema,
  clusterProfileId: identifierSchema,
  userName: z.string().trim().min(2, "Укажите имя пользователя").max(160),
  username: usernameSchema,
  password: fixedPasswordSchema,
  tenantRole: tenantRoleSchema.default("VIEWER"),
  sites: z.array(onboardingSiteSchema).min(1, "Добавьте хотя бы один сайт").max(50, "Можно добавить не более 50 сайтов"),
});

export const resetUserPasswordInputSchema = z.object({
  userId: identifierSchema,
  password: fixedPasswordSchema,
});

export const setUserEnabledInputSchema = z.object({
  userId: identifierSchema,
  enabled: z.boolean(),
});

export const identityAdminListQuerySchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).default(""),
  sort: z.enum(["name", "status", "createdAt", "updatedAt"]).default("updatedAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
});

export const createOrganizationInputSchema = z.object({
  slug: slugSchema,
  name: organizationNameSchema,
});

export const updateOrganizationInputSchema = z.object({
  organizationId: identifierSchema,
  version: positiveVersionSchema,
  slug: slugSchema,
  name: organizationNameSchema,
});

export const createMembershipInputSchema = z.object({
  organizationId: identifierSchema,
  userId: identifierSchema,
  tenantRole: tenantRoleSchema,
});

export const updateMembershipInputSchema = z.object({
  organizationId: identifierSchema,
  membershipId: identifierSchema,
  version: positiveVersionSchema,
  tenantRole: tenantRoleSchema,
});

export const removeMembershipInputSchema = z.object({
  organizationId: identifierSchema,
  membershipId: identifierSchema,
  version: positiveVersionSchema,
});

export type IdentityAdminListQuery = z.infer<typeof identityAdminListQuerySchema>;
export type CreateOrganizationInput = z.infer<typeof createOrganizationInputSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationInputSchema>;
export type CreateMembershipInput = z.infer<typeof createMembershipInputSchema>;
export type UpdateMembershipInput = z.infer<typeof updateMembershipInputSchema>;
export type RemoveMembershipInput = z.infer<typeof removeMembershipInputSchema>;
export type ProvisionClientInput = z.infer<typeof provisionClientInputSchema>;
export type ResetUserPasswordInput = z.infer<typeof resetUserPasswordInputSchema>;
export type SetUserEnabledInput = z.infer<typeof setUserEnabledInputSchema>;

export interface ProvisionClientResult {
  organizationId: string;
  projectId: string;
  userId: string;
  membershipId: string;
  siteIds: string[];
}

export interface IdentityAdminUserListItem {
  id: string;
  name: string;
  username: string;
  disabled: boolean;
  memberships: Array<{ id: string; organizationName: string; tenantRole: TenantRole }>;
}

export interface OrganizationListItem {
  id: string;
  slug: string;
  name: string;
  version: number;
  membershipCount: number;
  projectCount: number;
  updatedAt: string;
}

export interface OrganizationListResult {
  items: OrganizationListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MembershipListItem {
  id: string;
  organizationId: string;
  organizationName: string;
  userId: string;
  userName: string;
  userEmail: string;
  tenantRole: TenantRole;
  version: number;
  updatedAt: string;
}

export interface MembershipListResult {
  items: MembershipListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface IdentityAdminFormOptions {
  organizations: Array<{ id: string; name: string }>;
  users: Array<{ id: string; label: string }>;
}

export type IdentityAdminErrorCode =
  | "IDENTITY_ADMIN_ACCESS_DENIED"
  | "ORGANIZATION_NOT_FOUND_OR_FORBIDDEN"
  | "ORGANIZATION_STALE"
  | "ORGANIZATION_SLUG_CONFLICT"
  | "MEMBERSHIP_NOT_FOUND_OR_FORBIDDEN"
  | "MEMBERSHIP_STALE"
  | "MEMBERSHIP_ALREADY_EXISTS"
  | "MEMBERSHIP_REFERENCE_INVALID"
  | "USER_LOGIN_CONFLICT"
  | "USER_NOT_FOUND"
  | "PROJECT_SLUG_CONFLICT"
  | "PROJECT_REFERENCE_INVALID"
  | "SITE_SLUG_CONFLICT";

export class IdentityAdminError extends Error {
  constructor(public readonly code: IdentityAdminErrorCode) {
    super(code);
    this.name = "IdentityAdminError";
  }
}

export function nextIdentityVersion(
  version: number,
  staleCode: "ORGANIZATION_STALE" | "MEMBERSHIP_STALE",
): number {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new IdentityAdminError(staleCode);
  }
  return version + 1;
}
