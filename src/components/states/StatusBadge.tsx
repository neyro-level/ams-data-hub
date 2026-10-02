import { Badge } from "../ui/badge.tsx";

export type StatusTone = "success" | "warning" | "info" | "destructive" | "neutral";

const toneClassName: Record<StatusTone, string> = {
  success: "border-transparent bg-[var(--success-soft)] text-app-success",
  warning: "border-transparent bg-[var(--warning-soft)] text-app-warning",
  info: "border-transparent bg-[var(--info-soft)] text-app-info",
  destructive: "border-transparent bg-[var(--destructive-soft)] text-app-destructive",
  neutral: "border-transparent bg-[var(--status-neutral-soft)] text-app-status-neutral",
};

export function StatusBadge({ label, tone = "neutral" }: { label: string; tone?: StatusTone }) {
  return <Badge className={toneClassName[tone]}>{label}</Badge>;
}
