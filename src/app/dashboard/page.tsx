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
import { listProjectTreesForUser } from "../../modules/project-registry/server.ts";
import { hasPermission } from "../../platform/authorization/principal.ts";

export default async function DashboardPage() {
  const cabinetRedirect = await getCurrentCabinetRedirect();
  if (cabinetRedirect) redirect(cabinetRedirect);
  const state = await getCurrentPrincipalState();
  if (!state) redirect("/?login=1");

  const projects = await listProjectTreesForUser(state.principal);
  const organizationNames = new Set(projects.map((project) => project.organization.name));

  return (
    <div className="space-y-6">
      <PageHeader
        title="AMS Data Hub"
        description="Нейтральная рабочая область для будущих кабинетов, CRM, аналитики и внутренних процессов."
        actions={
          hasPermission(state.principal, "platform:manage") ? (
            <Link
              href="/admin/organizations/"
              className="rounded-[var(--radius)] bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-app-primary-foreground"
            >
              Администрирование
            </Link>
          ) : null
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Проекты" value={String(projects.length)} tone="primary" />
        <KpiCard label="Организации" value={String(organizationNames.size)} />
        <KpiCard label="Роль" value={state.principal.kind === "tenant-user" ? "Участник" : "Платформа"} />
        <KpiCard label="Статус" value="Готово" tone="success" />
      </section>

      <SectionCard title="Система готова к работе" note="Базовый слой">
        <ul className="grid gap-3 text-sm text-app-secondary md:grid-cols-2">
          <li className="rounded-[var(--radius-panel)] bg-[var(--muted)] p-4">Вход и права доступа настроены для каждой организации.</li>
          <li className="rounded-[var(--radius-panel)] bg-[var(--muted)] p-4">Проекты можно использовать как стартовую сущность для будущего продукта.</li>
          <li className="rounded-[var(--radius-panel)] bg-[var(--muted)] p-4">Outbox и worker готовы для фоновых задач без внешних API по умолчанию.</li>
          <li className="rounded-[var(--radius-panel)] bg-[var(--muted)] p-4">В кабинете отображаются только безопасные данные без паролей и ключей доступа.</li>
        </ul>
      </SectionCard>
    </div>
  );
}
