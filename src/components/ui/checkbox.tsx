"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Check } from "lucide-react";
import * as React from "react";
import { cn } from "../../shared/lib/cn.ts";

export function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return <CheckboxPrimitive.Root data-slot="checkbox" className={cn("peer flex size-5 shrink-0 items-center justify-center rounded-[var(--radius)] border border-[var(--input)] bg-[var(--background)] text-app-primary-foreground transition data-checked:border-[var(--primary)] data-checked:bg-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50", className)} {...props}><CheckboxPrimitive.Indicator className="flex data-unchecked:hidden"><Check className="size-3.5" strokeWidth={2.5} aria-hidden /></CheckboxPrimitive.Indicator></CheckboxPrimitive.Root>;
}
