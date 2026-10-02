import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../../shared/lib/cn.ts";

const badgeVariants = cva("inline-flex items-center rounded-[var(--radius)] border px-2 py-1 text-xs font-semibold", {
  variants: {
    variant: {
      default: "border-[var(--border)] bg-[var(--muted)] text-app-secondary",
      secondary: "border-transparent bg-[var(--secondary)] text-app-secondary-foreground",
      outline: "border-[var(--border)] bg-transparent text-app-foreground",
      destructive: "border-transparent bg-[var(--destructive-soft)] text-app-destructive",
      success: "border-transparent bg-[var(--success-soft)] text-app-success",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({ className, variant, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}
