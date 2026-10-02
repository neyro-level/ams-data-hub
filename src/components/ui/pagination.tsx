import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { cn } from "../../shared/lib/cn.ts";

export function Pagination({ page, pageCount, previousHref, nextHref, className }: { page: number; pageCount: number; previousHref: string; nextHref: string; className?: string }) {
  const previousDisabled = page <= 1;
  const nextDisabled = page >= pageCount;
  const linkClassName = "inline-flex min-h-11 items-center gap-2 rounded-[var(--radius)] border border-[var(--input)] bg-[var(--card)] px-3 text-sm font-semibold text-app-foreground transition hover:bg-[var(--accent)]";
  return (
    <nav aria-label="Пагинация" className={cn("flex items-center justify-between gap-3", className)}>
      <Link aria-disabled={previousDisabled} tabIndex={previousDisabled ? -1 : undefined} className={cn(linkClassName, previousDisabled && "pointer-events-none opacity-50")} href={previousHref}><ChevronLeft aria-hidden />Назад</Link>
      <span className="text-sm text-app-secondary">Страница {page} из {pageCount}</span>
      <Link aria-disabled={nextDisabled} tabIndex={nextDisabled ? -1 : undefined} className={cn(linkClassName, nextDisabled && "pointer-events-none opacity-50")} href={nextHref}>Далее<ChevronRight aria-hidden /></Link>
    </nav>
  );
}
