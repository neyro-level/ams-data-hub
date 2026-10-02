"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "../../shared/lib/cn.ts";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export function SheetContent({ className, children, side = "left", ...props }: React.ComponentProps<typeof DialogPrimitive.Popup> & { side?: "left" | "right" }) { return <DialogPrimitive.Portal><DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-[var(--overlay)] transition-opacity motion-reduce:transition-none data-ending-style:opacity-0 data-starting-style:opacity-0" /><DialogPrimitive.Popup data-slot="sheet-content" className={cn("fixed inset-y-0 z-50 w-[min(320px,88vw)] bg-[var(--card)] p-5 shadow-[var(--shadow-overlay)] transition-transform duration-200 motion-reduce:transition-none", side === "left" ? "left-0 data-ending-style:-translate-x-full data-starting-style:-translate-x-full" : "right-0 data-ending-style:translate-x-full data-starting-style:translate-x-full", className)} {...props}>{children}<DialogPrimitive.Close aria-label="Закрыть" className="absolute right-3 top-3 grid size-10 place-items-center rounded-[var(--radius)] text-app-muted-foreground hover:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]"><X className="size-4" aria-hidden /></DialogPrimitive.Close></DialogPrimitive.Popup></DialogPrimitive.Portal>; }
export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div className={cn("grid gap-2 pr-10", className)} {...props} />; }
export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;
