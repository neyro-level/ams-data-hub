import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";

type StatusBannerProps = { tone: "success" | "info" | "warning" | "error"; title: string; description: string };

const toneMap = {
  success: { wrapper: "border-[var(--success)]/25 bg-[var(--success-soft)] text-app-success", Icon: CheckCircle2 },
  info: { wrapper: "border-[var(--info)]/25 bg-[var(--info-soft)] text-app-info", Icon: Info },
  warning: { wrapper: "border-[var(--warning)]/25 bg-[var(--warning-soft)] text-app-warning", Icon: TriangleAlert },
  error: { wrapper: "border-[var(--destructive)]/25 bg-[var(--destructive-soft)] text-app-destructive", Icon: AlertCircle },
} as const;

export function StatusBanner({ tone, title, description }: StatusBannerProps) {
  const { wrapper, Icon } = toneMap[tone];
  return <div className={`flex gap-3 rounded-[var(--radius-panel)] border p-4 ${wrapper}`} role={tone === "error" ? "alert" : "status"}><Icon className="mt-0.5 size-5 shrink-0" strokeWidth={1.8} aria-hidden /><div className="space-y-1"><p className="text-sm font-semibold leading-5">{title}</p><p className="text-sm leading-5 text-app-foreground">{description}</p></div></div>;
}
