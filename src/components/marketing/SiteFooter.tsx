import Link from "next/link";
import { legalOperator } from "../../shared/legal/legal-config.ts";

export function SiteFooter() {
  return (
    <footer id="site-footer" className="public-surface border-t border-[var(--ch-border-subtle)] bg-[var(--ch-bg-deeper)] text-[var(--ch-muted-ondark)]" role="contentinfo">
      <div className="mx-auto flex w-full max-w-[1360px] flex-wrap items-center justify-center gap-x-2 gap-y-2 px-5 py-6 text-center text-xs sm:px-6">
        <span>© AMS</span><span aria-hidden>·</span>
        <span>ИП Скрицкая Юлия Викторовна</span><span aria-hidden>·</span>
        <span>ИНН {legalOperator.inn}</span><span aria-hidden>·</span>
        <span>ОГРНИП {legalOperator.ogrnip}</span><span aria-hidden>·</span>
        <a href={`mailto:${legalOperator.email}`} className="transition hover:text-[var(--ch-white)]">{legalOperator.email}</a><span aria-hidden>·</span>
        <Link href="/politika/" className="transition hover:text-[var(--ch-white)]">Политика обработки персональных данных</Link>
      </div>
    </footer>
  );
}
