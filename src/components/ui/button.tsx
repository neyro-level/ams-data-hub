import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../shared/lib/cn.ts";

export const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius)] px-4 text-sm font-semibold whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-[var(--primary)] text-app-primary-foreground hover:bg-[color-mix(in_srgb,var(--primary)_90%,white)]",
        secondary: "bg-[var(--secondary)] text-app-secondary-foreground hover:bg-[var(--accent)]",
        outline: "border border-[var(--input)] bg-[var(--background)] text-app-foreground hover:bg-[var(--accent)]",
        ghost: "text-app-foreground hover:bg-[var(--accent)]",
        link: "min-h-0 rounded-none px-0 text-app-link underline-offset-4 hover:underline",
        destructive: "bg-[var(--destructive)] text-app-destructive-foreground hover:bg-[color-mix(in_srgb,var(--destructive)_88%,black)]",
      },
      size: {
        default: "h-11",
        sm: "h-9 min-h-9 px-3 text-xs",
        lg: "h-12 min-h-12 px-6",
        icon: "size-11 min-h-11 px-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
