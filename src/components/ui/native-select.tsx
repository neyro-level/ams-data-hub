import { ChevronDown } from "lucide-react";
import * as React from "react";
import { cn } from "../../shared/lib/cn.ts";

export const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <div className="relative" data-slot="native-select-wrapper">
    <select
      ref={ref}
      data-slot="native-select"
      className={cn(
        "min-h-11 w-full appearance-none rounded-[var(--radius)] border border-[var(--input)] bg-[var(--card)] px-3 pr-10 text-sm text-app-foreground outline-none transition focus-visible:border-[var(--ring)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--ring)_20%,transparent)] disabled:bg-[var(--muted)] disabled:opacity-60 aria-invalid:border-[var(--destructive)]",
        className,
      )}
      {...props}
    >
      {children}
    </select>
    <ChevronDown
      aria-hidden
      className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-app-muted-foreground"
      strokeWidth={1.8}
    />
  </div>
));
NativeSelect.displayName = "NativeSelect";

export function NativeSelectOption(props: React.OptionHTMLAttributes<HTMLOptionElement>) {
  return <option data-slot="native-select-option" {...props} />;
}

export function NativeSelectOptGroup(props: React.OptgroupHTMLAttributes<HTMLOptGroupElement>) {
  return <optgroup data-slot="native-select-optgroup" {...props} />;
}
