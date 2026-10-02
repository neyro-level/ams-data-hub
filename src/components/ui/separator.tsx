import * as React from "react";
import { cn } from "../../shared/lib/cn.ts";

export function Separator({ orientation = "horizontal", decorative = true, className, ...props }: React.HTMLAttributes<HTMLDivElement> & { orientation?: "horizontal" | "vertical"; decorative?: boolean }) {
  return <div data-slot="separator" role={decorative ? "none" : "separator"} aria-orientation={decorative ? undefined : orientation} className={cn("shrink-0 bg-[var(--border)]", orientation === "horizontal" ? "h-px w-full" : "h-full w-px", className)} {...props} />;
}
