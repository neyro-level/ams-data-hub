import { ArrowLeft, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import styles from "../components/marketing/ImpulseLanding.module.css";

const quickLinks = [
  {
    href: "/",
    label: "Главная",
    description: "Вернуться к предложению AMS IMPULSE.",
  },
  {
    href: "/politika/",
    label: "Конфиденциальность",
    description: "Политика обработки персональных данных.",
  },
  {
    href: "/terms/",
    label: "Условия",
    description: "Общие условия сотрудничества с АМС.",
  },
] as const;

export default function NotFound() {
  return (
    <main className="theme-public impulse-landing relative isolate flex min-h-dvh items-center overflow-hidden bg-[var(--ch-bg-deepest)] px-5 py-14 text-[var(--ch-white)] sm:px-6">
      <div className={`${styles.grid} absolute inset-0 -z-20 opacity-70`} aria-hidden />
      <div className="absolute left-1/2 top-1/2 -z-10 -translate-x-1/2 -translate-y-1/2 select-none text-[clamp(170px,28vw,390px)] font-extrabold leading-none tracking-[-0.08em] text-[var(--ch-ghost-ondark)]" aria-hidden>
        404
      </div>
      <div className="absolute inset-0 -z-10 bg-[image:var(--ch-not-found-atmosphere)]" aria-hidden />

      <div className="mx-auto w-full max-w-[980px] text-center">
        <Link href="/" className="mx-auto inline-flex items-center gap-3" aria-label="AMS IMPULSE — на главную">
          <span className="grid size-12 place-items-center border border-[var(--ch-border-control)] bg-[var(--ch-surface-subtle)] text-xs font-extrabold">AMS</span>
          <span className="text-sm font-extrabold tracking-[0.16em]">IMPULSE</span>
        </Link>

        <p className="mt-10 flex items-center justify-center gap-3 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--ch-accent)]">
          <span className="h-px w-6 bg-[var(--ch-accent)]/70" aria-hidden />
          Маршрут не найден
          <span className="h-px w-6 bg-[var(--ch-accent)]/70" aria-hidden />
        </p>
        <h1 className="mt-5 text-[clamp(38px,6vw,66px)] font-extrabold leading-[1.04] tracking-[-0.045em] text-[var(--ch-white)]">
          Страница не существует
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-[var(--ch-copy-ondark)] sm:text-lg">
          Возможно, ссылка устарела или адрес введён с ошибкой. Вернитесь на главную или выберите доступный раздел.
        </p>

        <Link href="/" className="mx-auto mt-8 inline-flex min-h-12 items-center gap-2.5 bg-[var(--ch-accent)] px-6 text-sm font-bold text-[var(--ch-white)] transition hover:-translate-y-0.5 hover:bg-[var(--ch-accent-hover)]">
          <ArrowLeft className="size-4" strokeWidth={1.7} aria-hidden />
          Вернуться на главную
        </Link>

        <nav className="mt-12 grid gap-3 text-left sm:grid-cols-3" aria-label="Доступные разделы">
          {quickLinks.map((item, index) => (
            <Link key={item.href} href={item.href} className="group min-h-36 border border-[var(--ch-border-subtle)] bg-[var(--ch-surface-faint)] p-5 transition hover:-translate-y-0.5 hover:border-[var(--ch-accent)]/65 hover:bg-[var(--ch-surface-faint-hover)]">
              <span className="text-[10px] font-bold tracking-[0.16em] text-[var(--ch-accent)]">{String(index + 1).padStart(2, "0")}</span>
              <span className="mt-4 flex items-center justify-between gap-3 text-base font-bold text-[var(--ch-white)]">
                {item.label}
                <ArrowUpRight className="size-4 text-[var(--ch-icon-weak-ondark)] transition group-hover:text-[var(--ch-white)]" strokeWidth={1.6} aria-hidden />
              </span>
              <span className="mt-2 block text-sm leading-5 text-[var(--ch-subtle-ondark)]">{item.description}</span>
            </Link>
          ))}
        </nav>
      </div>
    </main>
  );
}
