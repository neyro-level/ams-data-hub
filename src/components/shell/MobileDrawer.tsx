"use client";

import { Menu } from "lucide-react";
import { useState } from "react";
import type { NavigationSection } from "../../modules/project-registry/presentation.ts";
import { Button } from "../ui/button.tsx";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../ui/sheet.tsx";
import { ShellNav } from "./ShellNav.tsx";

type MobileDrawerProps = {
  sections: NavigationSection[];
  currentPath: string;
};

export function MobileDrawer({ sections, currentPath }: MobileDrawerProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-expanded={open}
        aria-controls="mobile-report-nav"
        aria-label="Открыть навигацию"
        onClick={() => setOpen(true)}
      >
        <Menu className="size-5" strokeWidth={1.8} aria-hidden />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          id="mobile-report-nav"
          className="left-0 top-0 h-dvh w-[min(86vw,320px)] translate-x-0 translate-y-0 rounded-none border-r border-[var(--sidebar-border)] bg-[var(--sidebar)] p-3 text-app-sidebar-foreground data-ending-style:-translate-x-full data-starting-style:-translate-x-full lg:hidden"
        >
          <SheetHeader className="mb-4 flex flex-row items-center gap-2.5 rounded-[var(--radius-panel)] border border-[var(--sidebar-border)] bg-[var(--sidebar-surface)] p-2 pr-12">
            <span className="grid size-10 shrink-0 place-items-center rounded-[var(--radius)] bg-[var(--sidebar-ring)] text-[10px] font-bold tracking-[0.12em] text-app-sidebar-foreground">АМС</span>
            <SheetTitle className="text-[13px] font-semibold tracking-[0.12em] text-app-sidebar-foreground">ИМПУЛЬС</SheetTitle>
            <SheetDescription className="sr-only">Навигация по отчётам и разделам кабинета</SheetDescription>
          </SheetHeader>
          <ShellNav sections={sections} currentPath={currentPath} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
