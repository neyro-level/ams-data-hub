import type { ButtonProps } from "../ui/button.tsx";
import { Button } from "../ui/button.tsx";
import { cn } from "../../shared/lib/cn.ts";

type MarketingButtonProps = Omit<ButtonProps, "variant"> & {
  tone?: "primary" | "outline";
};

export function MarketingButton({ className, tone = "primary", ...props }: MarketingButtonProps) {
  return (
    <Button
      className={cn(
        "rounded-none",
        tone === "primary"
          ? "bg-[var(--ch-accent)] text-[var(--ch-white)] hover:-translate-y-0.5 hover:bg-[var(--ch-accent-hover)]"
          : "border border-[var(--ch-border-hover)] bg-[var(--ch-surface-subtle)] text-[var(--ch-white)] hover:border-[var(--ch-white)]/30 hover:bg-[var(--ch-surface-hover)]",
        className,
      )}
      variant="ghost"
      {...props}
    />
  );
}
