import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import {
  getCurrentCabinetRedirect,
  getCurrentPrincipalState,
} from "../../modules/identity-access/server.ts";
import { buildNavigation } from "../../modules/project-registry/presentation.ts";
import { getNotificationSummary } from "../../modules/notifications/server.ts";
import { AppShell } from "./AppShell.tsx";

function getRoleLabel(state: NonNullable<Awaited<ReturnType<typeof getCurrentPrincipalState>>>) {
  if (state.principal.kind === "platform-admin") return "Супер админ";
  if (state.principal.kind === "tenant-user") {
    return state.principal.role === "ORG_ADMIN"
      ? "Владелец организации"
      : state.principal.role === "ORG_EDITOR"
        ? "Участник организации"
        : "Наблюдатель";
  }
  return "Системный пользователь";
}

export async function PrivateApplicationLayout({ children }: { children: ReactNode }) {
  const cabinetRedirect = await getCurrentCabinetRedirect();
  if (cabinetRedirect) redirect(cabinetRedirect);
  const state = await getCurrentPrincipalState();
  if (!state) redirect("/?login=1");
  const sections = await buildNavigation("/", state.principal);
  const notificationSummary = state.principal.kind === "platform-admin"
    ? await getNotificationSummary(state.principal)
    : null;
  return <AppShell sections={sections} accountLabel={getRoleLabel(state)} notificationSummary={notificationSummary}>{children}</AppShell>;
}
