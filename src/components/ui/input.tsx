import * as React from "react";
import { cn } from "../../shared/lib/cn.ts";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "min-h-11 w-full rounded-[var(--radius)] border border-[var(--input)] bg-[var(--card)] px-3 text-sm text-app-foreground outline-none transition focus-visible:border-[var(--ring)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--ring)_20%,transparent)] disabled:bg-[var(--muted)] disabled:opacity-60 aria-invalid:border-[var(--destructive)]",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "min-h-28 w-full rounded-[var(--radius)] border border-[var(--input)] bg-[var(--card)] px-3 py-2 text-sm text-app-foreground outline-none transition focus-visible:border-[var(--ring)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--ring)_20%,transparent)] disabled:bg-[var(--muted)] disabled:opacity-60 aria-invalid:border-[var(--destructive)]",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
