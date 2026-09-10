export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { KpiCard } from "../../components/dashboard/KpiCard.tsx";
import { PageHeader } from "../../components/dashboard/PageHeader.tsx";
import { SectionCard } from "../../components/dashboard/SectionCard.tsx";
import {
  getCurrentCabinetRedirect,
  getCurrentPrincipalState,
} from "../../modules/identity-access/server.ts";
import { buildAnalystOverview } from "../../modules/project-registry/presentation.ts";
import { hasPermission } from "../../platform/authorization/principal.ts";

export default async function DashboardPage() {
  const cabinetRedirect = await getCurrentCabinetRedirect();
  if (cabinetRedirect) redirect(cabinetRedirect);
  const state = await getCurrentPrincipalState();
  if (!state) redirect("/?login=1");

  const overview = await buildAnalystOverview(state.principal);

  return (
    <>
      <div className="space-y-6">
        <PageHeader
          title="АМС ИМПУЛЬС"
          description="Проекты, сайты и понятные отчёты о результатах продвижения."
          actions={
            hasPermission(state.principal, "project:read:any") ? (
              <Link
                href="/analyst/"
                className="rounded-[var(--radius)] bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-app-primary-foreground"
              >
                Все проекты
              </Link>
            ) : null
          }
        />

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Проекты" value={String(overview.totalProjects)} tone="primary" />
          <KpiCard label="Сайты" value={String(overview.totalSites)} />
          <KpiCard label="Подключённые" value={String(overview.connectedSites)} />
          <KpiCard label="Плановые" value={String(overview.plannedSites)} tone="soft" />
        </section>

        <SectionCard title="Система готова к работе" note="Основные службы работают">
          <ul className="grid gap-3 text-sm text-app-secondary md:grid-cols-2">
            <li className="rounded-[var(--radius-panel)] bg-[var(--muted)] p-4">Вход и права доступа настроены для каждой организации.</li>
            <li className="rounded-[var(--radius-panel)] bg-[var(--muted)] p-4">Данные из Вебмастера, Метрики и Topvisor доступны только для просмотра.</li>
            <li className="rounded-[var(--radius-panel)] bg-[var(--muted)] p-4">Отчёты обновляются автоматически и сохраняются в системе.</li>
            <li className="rounded-[var(--radius-panel)] bg-[var(--muted)] p-4">В кабинете отображаются только безопасные данные без паролей и ключей доступа.</li>
          </ul>
        </SectionCard>
      </div>
    </>
  );
}
