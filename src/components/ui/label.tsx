import * as React from "react";
import { cn } from "../../shared/lib/cn.ts";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label data-slot="label" className={cn("text-sm font-medium leading-none", className)} {...props} />;
}
