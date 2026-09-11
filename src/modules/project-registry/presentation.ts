import { hasPermission, type PrincipalContext } from "../../platform/authorization/principal.ts";
import { listProjectTreesForUser } from "./server.ts";

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

export interface StarterOverview {
  organizations: number;
  projects: number;
  pendingJobs: number;
  deadLetterJobs: number;
}

export async function buildNavigation(
  currentPath: string,
  user: PrincipalContext,
): Promise<NavigationSection[]> {
  const projectTrees = await listProjectTreesForUser(user);
  const items: NavigationItem[] = projectTrees.map((project) => ({
    href: "/dashboard/",
    label: `${project.organization.name} · ${project.name}`,
    active: currentPath === "/dashboard/",
  }));

  return [
    {
      title: "",
      items: [
        {
          href: "/dashboard/",
          label: "Рабочая область",
          active: currentPath === "/dashboard/",
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
        ...(user.kind === "platform-admin" || user.kind === "platform-staff"
          ? [{ href: "/notifications/", label: "Уведомления", active: currentPath.startsWith("/notifications/") }]
          : []),
      ],
    },
    ...(items.length
      ? [
          {
            title: "Проекты",
            items,
          },
        ]
      : []),
  ];
}
