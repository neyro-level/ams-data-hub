import { Skeleton } from "../../../components/ui/skeleton.tsx";

export default function ProjectsLoading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Загрузка проектов">
      <div className="space-y-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-48" />
      </div>
      <Skeleton className="h-16 rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--card)]" />
      <Skeleton className="h-24 rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--card)]" />
      <Skeleton className="h-80 rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--card)]" />
    </div>
  );
}
