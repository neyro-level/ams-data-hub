import * as React from "react";
import { cn } from "../../shared/lib/cn.ts";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="skeleton" aria-hidden className={cn("animate-pulse rounded-[var(--radius)] bg-[var(--border)]", className)} {...props} />;
}
