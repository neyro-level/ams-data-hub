export const PLATFORM_ADMIN_RESOURCE_KEYS = [
  "organizations",
  "memberships",
  "projects",
  "catalog",
  "operations",
] as const;

export type PlatformAdminResourceKey = (typeof PLATFORM_ADMIN_RESOURCE_KEYS)[number];

export interface PlatformAdminResourceDefinition {
  key: PlatformAdminResourceKey;
  label: string;
  description: string;
  href: string;
}

export const PLATFORM_ADMIN_RESOURCES: readonly PlatformAdminResourceDefinition[] = [
  {
    key: "organizations",
    label: "Организации",
    description: "Компании, команды и рабочие пространства будущего продукта.",
    href: "/admin/organizations/",
  },
  {
    key: "memberships",
    label: "Участники и доступ",
    description: "Пользователи, роли и доступ к организациям.",
    href: "/admin/memberships/",
  },
  {
    key: "projects",
    label: "Проекты",
    description: "Нейтральные рабочие сущности для CRM, аналитики и кабинетов.",
    href: "/admin/projects/",
  },
  {
    key: "catalog",
    label: "Каталог",
    description: "Общий каталог застройщиков, жилых комплексов и корпусов.",
    href: "/admin/catalog/",
  },
  {
    key: "operations",
    label: "Операции",
    description: "Очередь, фоновые задания и техническая готовность платформы.",
    href: "/admin/operations/",
  },
];

export const NON_PROJECT_PLATFORM_ADMIN_RESOURCES = PLATFORM_ADMIN_RESOURCES.filter(
  (resource) => resource.key !== "projects",
);

export function isPlatformAdminResourceKey(value: string): value is PlatformAdminResourceKey {
  return PLATFORM_ADMIN_RESOURCE_KEYS.some((key) => key === value);
}

export function getPlatformAdminResourceDefinition(
  key: PlatformAdminResourceKey,
): PlatformAdminResourceDefinition {
  const resource = PLATFORM_ADMIN_RESOURCES.find((candidate) => candidate.key === key);
  if (!resource) {
    throw new Error(`Unknown platform admin resource: ${key}`);
  }
  return resource;
}
