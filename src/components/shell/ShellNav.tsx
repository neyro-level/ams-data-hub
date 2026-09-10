"use client";

import {
  Bell,
  BriefcaseBusiness,
  ChevronDown,
  Globe2,
  LayoutDashboard,
  PanelsTopLeft,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { NavigationSection } from "../../modules/project-registry/presentation.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.tsx";

type ShellNavProps = {
  sections: NavigationSection[];
  currentPath: string;
  collapsed?: boolean;
  onNavigate?: () => void;
};

function routeMatches(currentPath: string, href: string) {
  const normalizedHref = href.endsWith("/") ? href.slice(0, -1) : href;
  return currentPath === href || currentPath === normalizedHref || currentPath.startsWith(`${normalizedHref}/`);
}

function NavigationIcon({ href, child }: { href: string; child: boolean }) {
  const className = `${child ? "size-4" : "size-5"} shrink-0`;
  const props = { className, strokeWidth: 1.8, "aria-hidden": true } as const;

  if (child) return <Globe2 {...props} />;
  if (href.startsWith("/admin/")) return <SlidersHorizontal {...props} />;
  if (href.startsWith("/notifications/")) return <Bell {...props} />;
  if (href.startsWith("/analyst/") || href.startsWith("/dashboard/")) return <LayoutDashboard {...props} />;
  if (href.startsWith("/c/")) return <BriefcaseBusiness {...props} />;
  return <PanelsTopLeft {...props} />;
}

function navigationStateClass(active: boolean, muted?: boolean) {
  if (active) {
    return "border border-[var(--sidebar-active-border)] bg-[var(--sidebar-active)] font-medium text-app-sidebar-foreground";
  }
  return muted
    ? "border border-transparent text-app-sidebar-muted hover:bg-[var(--sidebar-surface)]"
    : "border border-transparent text-app-sidebar-foreground hover:bg-[var(--sidebar-hover)]";
}

function NavigationLink({ href, label, active, muted, collapsed, onNavigate, child = false }: { href: string; label: string; active: boolean; muted?: boolean; collapsed: boolean; onNavigate?: () => void; child?: boolean }) {
  const link = (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex items-center rounded-[var(--radius)] text-sm transition-colors ${collapsed ? "min-h-11 justify-center px-2" : child ? "min-h-10 gap-2.5 px-2.5" : "min-h-11 gap-3 px-3"} ${navigationStateClass(active, muted)}`}
    >
      <NavigationIcon href={href} child={child} />
      {collapsed ? <span className="sr-only">{label}</span> : <span className="truncate">{label}</span>}
    </Link>
  );

  return collapsed ? <Tooltip><TooltipTrigger render={link} /><TooltipContent>{label}</TooltipContent></Tooltip> : link;
}

export function ShellNav({ sections, currentPath, collapsed = false, onNavigate }: ShellNavProps) {
  const [projectExpansion, setProjectExpansion] = useState<Record<string, boolean>>({});

  return (
    <nav className={collapsed ? "space-y-4" : "space-y-6"} aria-label="Навигация по отчётам">
      {sections.map((section) => (
        <div key={section.title} className="space-y-2">
          {section.title && !collapsed ? <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-app-sidebar-muted">{section.title}</p> : null}
          <ul className="space-y-1">
            {section.items.map((item) => {
              const isProject = Boolean(item.children?.length);
              const active = item.href.startsWith("/admin/")
                ? currentPath.startsWith("/admin/")
                : routeMatches(currentPath, item.href);

              if (!isProject) {
                return <li key={item.href}><NavigationLink href={item.href} label={item.label} active={active} collapsed={collapsed} onNavigate={onNavigate} /></li>;
              }

              if (collapsed) {
                return <li key={item.href}><NavigationLink href={item.href} label={item.label} active={active} collapsed onNavigate={onNavigate} /></li>;
              }

              const projectPageActive = currentPath === item.href || currentPath === item.href.replace(/\/$/, "");
              const expanded = projectExpansion[item.href] ?? active;
              const regionId = `project-sites-${item.href.replace(/[^a-z0-9]+/gi, "-")}`;

              return (
                <li key={item.href} className="space-y-1">
                  <div className={`flex items-center rounded-[var(--radius)] transition-colors ${navigationStateClass(active)} ${active ? "border-l-2 border-l-[var(--sidebar-project-accent)]" : ""}`}>
                    <Link href={item.href} onClick={onNavigate} aria-current={projectPageActive ? "page" : undefined} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 px-3 text-sm">
                      <NavigationIcon href={item.href} child={false} />
                      <span className="truncate">{item.label}</span>
                    </Link>
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={regionId}
                      aria-label={`${expanded ? "Скрыть" : "Показать"} сайты: ${item.label}`}
                      className="mr-1 grid size-9 shrink-0 place-items-center rounded-[var(--radius)] text-app-sidebar-muted transition-colors hover:bg-[var(--sidebar-surface-hover)] hover:text-app-sidebar-foreground focus-visible:ring-2 focus-visible:ring-[var(--sidebar-ring)]"
                      onClick={() => setProjectExpansion((current) => ({ ...current, [item.href]: !expanded }))}
                    >
                      <ChevronDown className={`size-4 transition-transform duration-200 motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} aria-hidden />
                    </button>
                  </div>
                  {expanded ? (
                    <ul id={regionId} className="ml-4 space-y-0.5 border-l border-[var(--sidebar-group-border)] py-1 pl-2">
                      {item.children?.map((child) => (
                        <li key={child.href}>
                          <NavigationLink href={child.href} label={child.label} active={routeMatches(currentPath, child.href)} muted={child.muted} collapsed={false} onNavigate={onNavigate} child />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
