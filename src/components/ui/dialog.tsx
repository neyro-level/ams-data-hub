"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "../../shared/lib/cn.ts";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

export function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Backdrop>) {
  return <DialogPrimitive.Backdrop data-slot="dialog-overlay" className={cn("fixed inset-0 z-50 min-h-dvh bg-[var(--overlay)] backdrop-blur-sm transition-opacity duration-200 motion-reduce:transition-none data-ending-style:opacity-0 data-starting-style:opacity-0", className)} {...props} />;
}

export function DialogContent({ className, children, showCloseButton = true, ...props }: React.ComponentProps<typeof DialogPrimitive.Popup> & { showCloseButton?: boolean }) {
  return <DialogPortal><DialogOverlay /><DialogPrimitive.Popup data-slot="dialog-content" className={cn("fixed left-1/2 top-1/2 z-50 w-[min(528px,calc(100%_-_32px))] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-6 text-app-card-foreground shadow-[var(--shadow-overlay)] transition-[transform,opacity] duration-200 motion-reduce:transition-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 sm:p-8", className)} {...props}>{children}{showCloseButton ? <DialogClose aria-label="Закрыть" className="absolute right-4 top-4 grid size-10 place-items-center rounded-[var(--radius)] text-app-muted-foreground transition hover:bg-[var(--muted)] hover:text-app-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"><X className="size-4" aria-hidden /></DialogClose> : null}</DialogPrimitive.Popup></DialogPortal>;
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div data-slot="dialog-header" className={cn("flex flex-col gap-2 pr-10", className)} {...props} />; }
export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div data-slot="dialog-footer" className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />; }
export function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) { return <DialogPrimitive.Title data-slot="dialog-title" className={cn("text-xl font-semibold", className)} {...props} />; }
export function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) { return <DialogPrimitive.Description data-slot="dialog-description" className={cn("text-sm leading-6 text-app-muted-foreground", className)} {...props} />; }
