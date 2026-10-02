import Link, { type LinkProps } from "next/link";
import type { AnchorHTMLAttributes } from "react";
import { type VariantProps } from "class-variance-authority";
import { cn } from "../../shared/lib/cn.ts";
import { buttonVariants } from "./button.tsx";

type ButtonLinkProps = LinkProps & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> & VariantProps<typeof buttonVariants>;

export function ButtonLink({ className, variant, size, ...props }: ButtonLinkProps) {
  return <Link className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
