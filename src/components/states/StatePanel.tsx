import { AlertCircle, Ban, Clock3, LoaderCircle, PlugZap, SearchX } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../shared/lib/cn.ts";

type StateKind = "loading" | "empty" | "filtered-empty" | "stale" | "error" | "permission-denied" | "not-connected";

const iconMap = { loading: LoaderCircle, empty: SearchX, "filtered-empty": SearchX, stale: Clock3, error: AlertCircle, "permission-denied": Ban, "not-connected": PlugZap } as const;

export function StatePanel({ state, title, description, action, className }: { state: StateKind; title: string; description: string; action?: ReactNode; className?: string }) {
  const Icon = iconMap[state];
  return (
    <div className={cn("flex flex-col items-start gap-3 rounded-[var(--radius-panel)] border border-dashed border-[var(--border)] bg-[var(--muted)] p-5 text-left", className)} role={state === "error" || state === "permission-denied" ? "alert" : "status"}>
      <Icon className={cn("size-6 text-app-muted-foreground", state === "loading" && "animate-spin")} strokeWidth={1.8} aria-hidden />
      <div className="space-y-2"><h2 className="text-lg font-semibold leading-6 text-app-foreground">{title}</h2><p className="max-w-2xl text-sm leading-5 text-app-secondary">{description}</p></div>
      {action}
    </div>
  );
}

export const LoadingState = (props: Omit<React.ComponentProps<typeof StatePanel>, "state">) => <StatePanel state="loading" {...props} />;
export const EmptyState = (props: Omit<React.ComponentProps<typeof StatePanel>, "state">) => <StatePanel state="empty" {...props} />;
export const FilteredEmptyState = (props: Omit<React.ComponentProps<typeof StatePanel>, "state">) => <StatePanel state="filtered-empty" {...props} />;
export const ErrorState = (props: Omit<React.ComponentProps<typeof StatePanel>, "state">) => <StatePanel state="error" {...props} />;
export const PermissionDeniedState = (props: Omit<React.ComponentProps<typeof StatePanel>, "state">) => <StatePanel state="permission-denied" {...props} />;

export function StaleDataBanner({ children }: { children: ReactNode }) {
  return <div className="rounded-[var(--radius-panel)] border border-[var(--warning)]/25 bg-[var(--warning-soft)] px-4 py-3 text-sm text-app-warning" role="status">{children}</div>;
}
