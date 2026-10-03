import { Badge } from "../ui/badge.tsx";

export type StatusTone = "success" | "warning" | "info" | "destructive" | "muted";

const toneClassName: Record<StatusTone, string> = {
  success: "border-transparent bg-[var(--success-soft)] text-app-success",
  warning: "border-transparent bg-[var(--warning-soft)] text-app-warning",
  info: "border-transparent bg-[var(--info-soft)] text-app-info",
  destructive: "border-transparent bg-[var(--destructive-soft)] text-app-destructive",
  muted: "border-transparent bg-[var(--status-muted-soft)] text-app-status-muted",
};

export function StatusBadge({ label, tone = "muted" }: { label: string; tone?: StatusTone }) {
  return <Badge className={toneClassName[tone]}>{label}</Badge>;
}
