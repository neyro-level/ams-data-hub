import { ChartSkeleton } from "../../../../components/charts/AnalyticsCard.tsx";
import { Skeleton } from "../../../../components/ui/skeleton.tsx";

export default function SiteReportLoading() {
  return <div className="space-y-8" aria-label="Загрузка отчёта" aria-busy="true"><div className="space-y-3 border-b border-[var(--border)] pb-5"><Skeleton className="h-4 w-40" /><Skeleton className="h-8 w-72 max-w-full" /><Skeleton className="h-5 w-[560px] max-w-full" /></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Skeleton className="h-32 rounded-[var(--radius-card)]" key={index} />)}</div><ChartSkeleton title="Загрузка динамики поисковой видимости" /><Skeleton className="h-80 rounded-[var(--radius-card)]" /></div>;
}
