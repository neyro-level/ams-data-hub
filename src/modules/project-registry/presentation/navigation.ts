import {
  hasPermission,
  type PrincipalContext,
} from "../../../platform/authorization/principal.ts";
import { getProjectService } from "../../../infrastructure/service-container.ts";

export type NavigationChild = {
  href: string;
  label: string;
  active: boolean;
  muted?: boolean;
};

export type NavigationItem = {
  href: string;
  label: string;
  active: boolean;
  children?: NavigationChild[];
};

export type NavigationSection = {
  title: string;
  items: NavigationItem[];
};

export async function buildNavigation(
  currentPath: string,
  user: PrincipalContext,
): Promise<NavigationSection[]> {
  const projectTrees = await getProjectService().listProjectTreesForUser(user);
  const items: NavigationItem[] = projectTrees.map((project) => ({
    href: `/c/${project.projectSlug}/`,
    label: project.name,
    active:
      currentPath === `/c/${project.projectSlug}/` ||
      currentPath.startsWith(`/c/${project.projectSlug}/`),
    children: project.sites.map((site) => ({
      href: `/c/${project.projectSlug}/${site.siteSlug}/`,
      label: site.name,
      active: currentPath === `/c/${project.projectSlug}/${site.siteSlug}/`,
      muted: !site.enabled,
    })),
  }));

  const hasGlobalProjectAccess = hasPermission(user, "project:read:any");
  const rootHref = hasGlobalProjectAccess ? "/analyst/" : "/dashboard/";
  const rootLabel = hasGlobalProjectAccess ? "Все проекты" : "Мои проекты";

  return [
    {
      title: "",
      items: [
        {
          href: rootHref,
          label: rootLabel,
          active: currentPath === rootHref,
        },
        ...(hasPermission(user, "platform:manage")
          ? [
              {
                href: "/admin/organizations/",
                label: "Администрирование",
                active: currentPath.startsWith("/admin/"),
              },
            ]
          : []),
        ...(user.kind === "platform-admin" || user.kind === "platform-analyst"
          ? [{ href: "/notifications/", label: "Уведомления", active: currentPath.startsWith("/notifications/") }]
          : []),
      ],
    },
    {
      title: "Проекты",
      items,
    },
  ];
}
