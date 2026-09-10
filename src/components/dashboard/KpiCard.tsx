type KpiCardProps = {
  label: string;
  value: string;
  tone?: "default" | "primary" | "soft" | "success";
  delta?: string;
  deltaTone?: "positive" | "negative" | "neutral";
};

const toneMap: Record<NonNullable<KpiCardProps["tone"]>, string> = {
  default: "border-[var(--border)] bg-[var(--card)] text-app-foreground",
  primary: "border-[var(--primary)] bg-[var(--primary)] text-app-primary-foreground",
  soft: "border-[var(--info)]/20 bg-[var(--info-soft)] text-app-foreground",
  success: "border-[var(--success)]/20 bg-[var(--success-soft)] text-app-foreground",
};

export function KpiCard({
  label,
  value,
  tone = "default",
  delta,
  deltaTone = "neutral",
}: KpiCardProps) {
  return (
    <article className={`rounded-[var(--radius-card)] border p-5 shadow-[var(--shadow-surface)] ${toneMap[tone]}`}>
      <p
        className={`text-xs font-semibold uppercase ${
          tone === "primary" ? "text-app-primary-foreground opacity-75" : "text-app-muted-foreground"
        }`}
      >
        {label}
      </p>
      <p className="mt-3 text-[30px] font-semibold leading-9 tabular-nums">{value}</p>
      {delta ? (
        <p
          className={[
            "mt-2 text-xs font-semibold tabular-nums",
            tone === "primary"
              ? "text-app-primary-foreground opacity-85"
              : deltaTone === "positive"
                ? "text-app-success"
                : deltaTone === "negative"
                  ? "text-app-destructive"
                  : "text-app-muted-foreground",
          ].join(" ")}
        >
          {delta}
        </p>
      ) : null}
    </article>
  );
}
