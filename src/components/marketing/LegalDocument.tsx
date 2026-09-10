import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { legalOperator } from "../../shared/legal/legal-config.ts";
import { SiteFooter } from "./SiteFooter.tsx";
import styles from "./LegalDocument.module.css";

type LegalDocumentProps = {
  eyebrow: string;
  title: string;
  description: string;
  version: string;
  effectiveDate: string;
  children: ReactNode;
};

export function LegalDocument({ eyebrow, title, description, version, effectiveDate, children }: LegalDocumentProps) {
  return (
    <main className="theme-public impulse-landing min-h-screen bg-[var(--ch-bg-page)] text-[var(--ch-text-primary)]">
      <header className="bg-[var(--ch-bg-deepest)] text-[var(--ch-white)]">
        <div className="mx-auto w-full max-w-[1120px] px-5 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-8">
          <div className="flex items-center justify-between gap-6">
            <Link href="/" className="inline-flex items-center gap-3" aria-label="AMS IMPULSE — на главную">
              <span className="grid size-10 place-items-center border border-[var(--ch-border-control)] bg-[var(--ch-surface-subtle)] text-[11px] font-extrabold">AMS</span>
              <span className="text-sm font-extrabold tracking-[0.16em]">IMPULSE</span>
            </Link>
            <Link href="/" className="inline-flex min-h-11 items-center gap-2 border border-[var(--ch-border-control)] px-4 text-sm font-semibold text-[var(--ch-action-ondark)] transition hover:border-[var(--ch-border-strong)] hover:text-[var(--ch-white)]">
              <ArrowLeft className="size-4" strokeWidth={1.6} aria-hidden />
              <span className="hidden sm:inline">На главную</span>
            </Link>
          </div>

          <div className="mt-16 max-w-4xl sm:mt-24">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--ch-accent)]">{eyebrow}</p>
            <h1 className="mt-5 text-[clamp(38px,5vw,66px)] font-extrabold leading-[1.04] tracking-[-0.04em] text-[var(--ch-white)]">{title}</h1>
            <p className="mt-6 max-w-3xl text-base leading-7 text-[var(--ch-muted-ondark)] sm:text-lg">{description}</p>
            <div className="mt-8 flex flex-wrap gap-x-7 gap-y-2 border-t border-[var(--ch-border-subtle)] pt-5 text-xs text-[var(--ch-subtle-ondark)]">
              <span>{version}</span>
              <span>Дата: {effectiveDate}</span>
              <span>Оператор: {legalOperator.name}</span>
            </div>
          </div>
        </div>
      </header>

      <article className={`${styles.prose} mx-auto w-full max-w-[1120px] px-5 py-14 text-left sm:px-6 sm:py-20`}>
        <div className="max-w-[920px]">{children}</div>
      </article>

      <SiteFooter />
    </main>
  );
}
