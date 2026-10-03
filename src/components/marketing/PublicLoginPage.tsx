import Link from "next/link";
import { LoginDialog } from "../../modules/identity-access/client.ts";
import { productIdentity } from "../../platform/config/product-identity.ts";
import { SiteFooter } from "./SiteFooter.tsx";
import styles from "./PublicLoginPage.module.css";

export function PublicLoginPage({ loginRequested }: { loginRequested: boolean }) {
  return (
    <main className="theme-public public-surface flex min-h-dvh flex-col overflow-hidden bg-[var(--ch-bg-deepest)] text-[var(--ch-white)]">
      <section className="relative isolate flex flex-1 flex-col">
        <div className={`${styles.grid} absolute inset-0 -z-20`} aria-hidden />
        <div className={`${styles.atmosphere} absolute inset-0 -z-10`} aria-hidden />

        <header className="mx-auto flex w-full max-w-[1360px] items-center justify-between px-5 py-5 sm:px-6 lg:py-7">
          <Link href="/" className="inline-flex min-h-11 items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ch-accent)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--ch-bg-deepest)]" aria-label={`${productIdentity.appName} — главная`}>
            <span className="grid size-10 place-items-center border border-[var(--ch-border-hover)] bg-[var(--ch-surface-subtle)] text-[11px] font-extrabold">АМС</span>
            <span className="text-sm font-extrabold">{productIdentity.wordmark}</span>
          </Link>
          <Link href="/politika/" className="min-h-11 content-center text-xs font-semibold text-[var(--ch-muted-ondark)] transition hover:text-[var(--ch-white)]">
            Политика обработки данных
          </Link>
        </header>

        <div className="mx-auto flex w-full max-w-[900px] flex-1 items-center justify-center px-5 py-16 text-center sm:px-6">
          <div className="w-full max-w-2xl border border-[var(--ch-border-subtle)] bg-[var(--ch-bg-deeper)]/80 px-6 py-12 shadow-[var(--ch-overlay-shadow)] backdrop-blur-md sm:px-12 sm:py-16">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--ch-accent)]">Закрытая рабочая система</p>
            <h1 className="mt-5 text-[clamp(44px,7vw,76px)] font-extrabold leading-[0.98] tracking-[-0.05em]">{productIdentity.appName}</h1>
            <p className="mx-auto mt-7 max-w-xl text-base leading-7 text-[var(--ch-soft-white)] sm:text-lg">
              Единая платформа АМС для управления данными, проектами и внутренними операциями.
            </p>
            <div className="mt-9 flex justify-center">
              <LoginDialog initialOpen={loginRequested} />
            </div>
            <p className="mt-6 text-xs leading-5 text-[var(--ch-muted-ondark)]">Доступ предоставляется только созданным оператором учётным записям.</p>
          </div>
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
