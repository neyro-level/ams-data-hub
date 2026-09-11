import Link from "next/link";
import styles from "../../components/marketing/StartLanding.module.css";

export default function OfflinePage() {
  return (
    <main className="theme-public start-landing relative isolate flex min-h-dvh items-center overflow-hidden bg-[var(--ch-bg-deepest)] px-5 py-14 text-[var(--ch-white)] sm:px-6">
      <div className={`${styles.grid} absolute inset-0 -z-20 opacity-70`} aria-hidden />
      <div className="absolute inset-0 -z-10 bg-[image:var(--ch-not-found-atmosphere)]" aria-hidden />
      <div className="mx-auto w-full max-w-[720px] text-center">
        <Link href="/" className="mx-auto inline-flex items-center gap-3" aria-label="АМС Старт - на главную">
          <span className="grid size-12 place-items-center border border-[var(--ch-border-control)] bg-[var(--ch-surface-subtle)] text-xs font-extrabold">АМС</span>
          <span className="text-sm font-extrabold">СТАРТ</span>
        </Link>
        <p className="mt-10 text-[11px] font-bold uppercase text-[var(--ch-accent)]">Нет соединения</p>
        <h1 className="mt-5 text-[clamp(38px,6vw,64px)] font-extrabold leading-[1.04] text-[var(--ch-white)]">
          Откройте страницу снова, когда появится интернет
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-[var(--ch-copy-ondark)] sm:text-lg">
          Приватные разделы и API не кешируются. Это защищает рабочие данные будущих приложений.
        </p>
      </div>
    </main>
  );
}
