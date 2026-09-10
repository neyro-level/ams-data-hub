"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import * as React from "react";
import { cn } from "../../shared/lib/cn.ts";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverClose = PopoverPrimitive.Close;
export function PopoverContent({ className, sideOffset = 8, ...props }: React.ComponentProps<typeof PopoverPrimitive.Popup> & { sideOffset?: number }) {
  return <PopoverPrimitive.Portal><PopoverPrimitive.Positioner sideOffset={sideOffset} align="end"><PopoverPrimitive.Popup data-slot="popover-content" className={cn("z-50 w-96 max-w-[calc(100vw-2rem)] rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--popover)] p-3 text-app-popover-foreground shadow-[var(--shadow-overlay)] outline-none transition motion-reduce:transition-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0", className)} {...props} /></PopoverPrimitive.Positioner></PopoverPrimitive.Portal>;
}
