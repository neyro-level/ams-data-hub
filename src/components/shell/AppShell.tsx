"use client";

import { LogOut } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { NavigationSection } from "../../modules/project-registry/presentation.ts";
import { authClient } from "../../platform/auth/client.ts";
import { Button } from "../ui/button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.tsx";
import { MobileDrawer } from "./MobileDrawer.tsx";
import { ShellNav } from "./ShellNav.tsx";
import { NotificationCenter } from "../notifications/NotificationCenter.tsx";
import type { NotificationListResult } from "../../modules/notifications/index.ts";

type AppShellProps = {
  sections: NavigationSection[];
  accountLabel: string;
  children: ReactNode;
  notificationSummary: NotificationListResult | null;
};

export function AppShell({ sections, accountLabel, notificationSummary, children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const activeLabel = sections
    .flatMap((section) => section.items.flatMap((item) => [item, ...(item.children ?? [])]))
    .find((item) => pathname === item.href || pathname.startsWith(item.href))?.label;

  async function signOut() {
    setSigningOut(true);
    await authClient.signOut();
    router.replace("/");
    router.refresh();
  }

  return (
    <div className="theme-app admin-root min-h-screen bg-[var(--background)] text-app-foreground" data-shell-theme="impulse">
      <aside className={`fixed inset-y-0 left-0 z-40 hidden transition-[width] duration-200 motion-reduce:transition-none lg:block ${collapsed ? "w-[76px]" : "w-[232px]"}`}>
        <div className="relative flex h-full flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar)] text-app-sidebar-foreground">
          <Tooltip>
            <TooltipTrigger render={<Button type="button" variant="ghost" size="icon" className="sidebar-collapse-widget absolute -right-4 top-3 z-10 h-10 min-h-10 w-8 p-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0" data-collapsed={collapsed ? "true" : "false"} aria-label={collapsed ? "Развернуть боковое меню" : "Свернуть боковое меню"} aria-pressed={collapsed} onClick={() => setCollapsed((value) => !value)} />} />
            <TooltipContent>{collapsed ? "Развернуть меню" : "Свернуть меню"}</TooltipContent>
          </Tooltip>

          <div className={`flex h-16 items-center px-2.5 ${collapsed ? "justify-center" : ""}`}>
            <div className={`flex min-w-0 items-center rounded-[var(--radius-panel)] border border-[var(--sidebar-border)] bg-[var(--sidebar-surface)] p-1.5 ${collapsed ? "justify-center" : "flex-1 gap-2.5"}`}>
              <span className="grid size-10 shrink-0 place-items-center rounded-[var(--radius)] bg-[var(--sidebar-ring)] text-[10px] font-bold tracking-[0.12em] text-app-sidebar-foreground">АМС</span>
              {collapsed ? null : <span className="truncate text-[13px] font-semibold tracking-[0.12em] text-app-sidebar-foreground">ИМПУЛЬС</span>}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-5">
            <ShellNav sections={sections} currentPath={pathname} collapsed={collapsed} />
          </div>

          <div className="border-t border-[var(--sidebar-border)] p-2">
            <div className={`flex min-h-10 items-center gap-1 rounded-[var(--radius)] bg-[var(--sidebar-surface)] ${collapsed ? "flex-col py-1.5" : "px-2"}`}>
              <p className={collapsed ? "sr-only" : "min-w-0 flex-1 truncate text-xs font-medium text-app-sidebar-foreground"}>{accountLabel}</p>
              {notificationSummary ? <NotificationCenter initialSummary={notificationSummary} surface="sidebar" /> : null}
              <Button type="button" variant="ghost" size="icon" className="sidebar-action size-8 min-h-8" onClick={signOut} disabled={signingOut} aria-label="Выйти из кабинета">
                <LogOut className="size-3.5" aria-hidden />
              </Button>
            </div>
          </div>
        </div>
      </aside>

      <div className={`min-h-screen min-w-0 overflow-x-hidden transition-[padding] duration-200 motion-reduce:transition-none ${collapsed ? "lg:pl-[76px]" : "lg:pl-[232px]"}`}>
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-[var(--border)] bg-[var(--card)]/95 px-4 backdrop-blur sm:px-6 lg:hidden">
          <MobileDrawer sections={sections} currentPath={pathname} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-app-foreground">{activeLabel ?? "АМС ИМПУЛЬС"}</p>
          </div>
          {notificationSummary ? <NotificationCenter initialSummary={notificationSummary} /> : null}
          <Button type="button" variant="ghost" size="icon" className="lg:hidden" onClick={signOut} disabled={signingOut} aria-label="Выйти из кабинета"><LogOut aria-hidden /></Button>
        </header>

        <main className="min-w-0 w-full overflow-x-hidden px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
