import { Loader2 } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../../shared/lib/cn.ts";

export function Spinner({ className, ...props }: ComponentProps<typeof Loader2>) {
  return <Loader2 data-slot="spinner" aria-hidden className={cn("size-4 animate-spin", className)} {...props} />;
}
