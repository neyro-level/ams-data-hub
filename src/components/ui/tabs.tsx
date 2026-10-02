"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import type { ComponentProps } from "react";
import { cn } from "../../shared/lib/cn.ts";

export function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>) { return <TabsPrimitive.Root className={cn("min-w-0", className)} {...props} />; }
export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) { return <TabsPrimitive.List className={cn("flex min-h-11 max-w-full gap-1 overflow-x-auto rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--muted)] p-1", className)} {...props} />; }
export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Tab>) { return <TabsPrimitive.Tab className={cn("min-h-9 shrink-0 rounded-[var(--radius)] px-3 text-sm font-semibold text-app-muted-foreground outline-none transition-colors hover:text-app-foreground focus-visible:ring-2 focus-visible:ring-[var(--ring)] data-[selected]:bg-[var(--card)] data-[selected]:text-app-foreground data-[selected]:shadow-[var(--shadow-surface)]", className)} {...props} />; }
export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Panel>) { return <TabsPrimitive.Panel className={cn("mt-5 outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]", className)} {...props} />; }
