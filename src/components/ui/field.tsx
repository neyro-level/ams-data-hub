import * as React from "react";
import { cn } from "../../shared/lib/cn.ts";

export function Field({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div data-slot="field" className={cn("grid gap-2", className)} {...props} />; }
export function FieldLabel({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) { return <label data-slot="field-label" className={cn("text-sm font-medium text-app-foreground", className)} {...props} />; }
export function FieldDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) { return <p data-slot="field-description" className={cn("text-xs leading-5 text-app-muted-foreground", className)} {...props} />; }
export function FieldError({ className, children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) { if (!children) return null; return <p data-slot="field-error" role="alert" className={cn("text-xs leading-5 text-app-destructive", className)} {...props}>{children}</p>; }
export function FieldGroup({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div data-slot="field-group" className={cn("grid gap-4", className)} {...props} />; }
