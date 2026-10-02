import { Skeleton } from "../../../components/ui/skeleton.tsx";

export default function AdminResourceLoading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Загрузка раздела администрирования">
      <div className="space-y-3">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-5 w-80" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton className="h-28 rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--card)]" key={index} />
        ))}
      </div>
      <Skeleton className="h-14 rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--card)]" />
      <Skeleton className="h-20 rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--card)]" />
      <Skeleton className="h-80 rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--card)]" />
    </div>
  );
}
