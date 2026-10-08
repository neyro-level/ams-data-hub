import type {
  FleetDashboard as FleetDashboardData,
  FleetSourceHealth,
} from "../../../modules/operations-control/index.ts";
import { KpiCard } from "../../../components/dashboard/KpiCard.tsx";
import { OperationsControlForms } from "./OperationsControlForms.tsx";
import { operationalRequestStateLabel } from "../../../modules/operations-control/index.ts";

const sourceHealthLabels: Record<FleetSourceHealth, string> = {
  DISABLED: "Отключён",
  NEVER_RUN: "Ещё не запускался",
  GOOD: "GOOD",
  STALE: "Устарел",
  ATTENTION: "Требует проверки",
};

const sourceHealthClasses: Record<FleetSourceHealth, string> = {
  DISABLED: "bg-[var(--muted)] text-app-muted-foreground",
  NEVER_RUN: "bg-[var(--warning-soft)] text-app-foreground",
  GOOD: "bg-[var(--success-soft)] text-app-success",
  STALE: "bg-[var(--warning-soft)] text-app-foreground",
  ATTENTION: "bg-[var(--destructive-soft)] text-app-destructive",
};

const issueLabels = {
  LATEST_ATTEMPT_NOT_GOOD: "Последняя попытка не стала GOOD",
  NO_SUCCESS_YET: "Нет успешного запуска",
  STALE_SUCCESS: "Успех старше двух интервалов",
} as const;

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
}

export function FleetDashboard({ data, initialIdempotencyKey }: { data: FleetDashboardData; initialIdempotencyKey: string }) {
  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6" aria-label="Сводка состояния платформы">
        <KpiCard label="Организации" value={String(data.summary.organizations)} tone="primary" />
        <KpiCard label="Проекты" value={String(data.summary.projects)} />
        <KpiCard label="Источники" value={String(data.summary.sources)} />
        <KpiCard label="С проблемами" value={String(data.summary.projectsWithIssues)} tone="soft" />
        <KpiCard label="Ждут ACK" value={String(data.summary.unacknowledgedDeliveries)} tone="soft" />
        <KpiCard label="Ошибки jobs" value={String(data.summary.failedJobs)} />
      </section>

      <OperationsControlForms initialIdempotencyKey={initialIdempotencyKey} jobsFrozen={data.dataSafety.jobsFrozen} projects={data.projects} />

      <section className="space-y-3" aria-labelledby="fleet-projects-title">
        <div>
          <h2 id="fleet-projects-title" className="text-lg font-semibold text-app-foreground">Проекты</h2>
          <p className="mt-1 text-sm text-app-secondary">Данные обновлены {formatDate(data.generatedAt)}. Секреты, PII и object keys в эту проекцию не входят.</p>
        </div>
        {data.projects.length === 0 ? (
          <div className="rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--card)] p-5 text-sm text-app-secondary">Проекты ещё не созданы.</div>
        ) : (
          <div className="grid gap-4">
            {data.projects.map((project) => (
              <article key={project.projectId} className="rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-surface)]">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-app-muted-foreground">{project.organizationName}</p>
                    <h3 className="mt-1 text-base font-semibold text-app-foreground">{project.projectName}</h3>
                    <p className="mt-1 text-sm text-app-secondary">{project.projectSlug} · {project.projectStatus} · {project.serviceState}</p>
                  </div>
                  <span className="w-fit rounded-full bg-[var(--muted)] px-3 py-1 text-xs font-semibold text-app-secondary">
                    Проблемы: {project.issueCount}
                  </span>
                </div>

                <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-[var(--radius)] bg-[var(--muted)] p-3">
                    <dt className="text-xs font-semibold uppercase text-app-muted-foreground">Snapshot</dt>
                    <dd className="mt-1 text-sm font-semibold text-app-foreground">{project.currentSnapshot ? `Sequence ${project.currentSnapshot.publishSequence}` : "Нет публикации"}</dd>
                    <dd className="mt-1 text-xs text-app-secondary">{formatDate(project.currentSnapshot?.publishedAt ?? null)}</dd>
                  </div>
                  <div className="rounded-[var(--radius)] bg-[var(--muted)] p-3">
                    <dt className="text-xs font-semibold uppercase text-app-muted-foreground">Delivery</dt>
                    <dd className="mt-1 text-sm font-semibold text-app-foreground">{project.latestDelivery?.status ?? "Нет доставки"}</dd>
                    <dd className="mt-1 text-xs text-app-secondary">{project.latestDelivery ? `Sequence ${project.latestDelivery.publishSequence}` : "—"}</dd>
                  </div>
                  <div className="rounded-[var(--radius)] bg-[var(--muted)] p-3">
                    <dt className="text-xs font-semibold uppercase text-app-muted-foreground">ACK</dt>
                    <dd className="mt-1 text-sm font-semibold text-app-foreground">{project.latestDelivery?.acknowledgedAt ? "Подтверждён" : "Нет подтверждения"}</dd>
                    <dd className="mt-1 text-xs text-app-secondary">{formatDate(project.latestDelivery?.acknowledgedAt ?? null)}</dd>
                  </div>
                  <div className="rounded-[var(--radius)] bg-[var(--muted)] p-3">
                    <dt className="text-xs font-semibold uppercase text-app-muted-foreground">Ошибка delivery</dt>
                    <dd className="mt-1 break-all text-sm font-semibold text-app-foreground">{project.latestDelivery?.safeErrorCode ?? "Нет"}</dd>
                  </div>
                </dl>

                <section className="mt-4 space-y-2" aria-label={`История операций: ${project.projectName}`}>
                  <h4 className="text-sm font-semibold text-app-foreground">История операций</h4>
                  <p className="text-xs text-app-secondary">До 25 последних запросов. Обновите страницу для нового состояния; принятие запроса не означает публикацию.</p>
                  {project.operationalRequests.length === 0 ? <p className="text-sm text-app-secondary">Операционных запросов ещё нет.</p> : (
                    <ul className="space-y-2">
                      {project.operationalRequests.map((request) => (
                        <li key={request.requestId} className="rounded-[var(--radius)] bg-[var(--muted)] p-3 text-sm">
                          <p className="font-semibold text-app-foreground">{request.action} · {request.status}</p>
                          <p className={request.status === "FAILED" ? "text-app-destructive" : "text-app-secondary"}>{operationalRequestStateLabel(request)}</p>
                          <p className="break-all text-xs text-app-secondary">ID: {request.requestId}</p>
                          {request.resultSummary && "buildInputId" in request.resultSummary ? <p className="break-all text-xs text-app-secondary">Build ID: {request.resultSummary.buildInputId}</p> : null}
                          {request.resultSummary && "publishSequence" in request.resultSummary ? <p className="text-xs text-app-secondary">Sequence: {request.resultSummary.publishSequence}</p> : null}
                          {request.resultSummary?.action === "ACK_ROTATE" ? <p className="text-xs text-app-secondary">ACK {request.resultSummary.phase} · версия {request.resultSummary.credentialVersion}</p> : null}
                          <p className="text-xs text-app-secondary">Принят: {formatDate(request.requestedAt)} · Начат: {formatDate(request.startedAt)} · Завершён: {formatDate(request.finishedAt)}</p>
                          {request.safeErrorCode ? <p className="break-all text-xs text-app-destructive">Код: {request.safeErrorCode}</p> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[900px] text-left text-sm">
                    <thead className="border-b border-[var(--border)] text-xs uppercase text-app-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Источник</th>
                        <th className="px-3 py-2 font-semibold">Состояние</th>
                        <th className="px-3 py-2 font-semibold">Последняя попытка</th>
                        <th className="px-3 py-2 font-semibold">Последний успех</th>
                        <th className="px-3 py-2 font-semibold">Last Good</th>
                        <th className="px-3 py-2 font-semibold">Проблема</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {project.sources.length === 0 ? (
                        <tr><td className="px-3 py-3 text-app-secondary" colSpan={6}>Источники не настроены.</td></tr>
                      ) : project.sources.map((source) => (
                        <tr key={source.sourceId}>
                          <td className="px-3 py-3 font-medium text-app-foreground">{source.name}</td>
                          <td className="px-3 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${sourceHealthClasses[source.health]}`}>{sourceHealthLabels[source.health]}</span></td>
                          <td className="px-3 py-3 text-app-secondary">{formatDate(source.lastAttemptAt)}</td>
                          <td className="px-3 py-3 text-app-secondary">{formatDate(source.lastSuccessAt)}</td>
                          <td className="px-3 py-3 text-app-secondary">{source.hasLastGoodRevision ? "Есть" : "Нет"}</td>
                          <td className="px-3 py-3 text-app-secondary">{source.issueCode ? issueLabels[source.issueCode] : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="failed-jobs-title">
        <div>
          <h2 id="failed-jobs-title" className="text-lg font-semibold text-app-foreground">Последние ошибки jobs</h2>
          <p className="mt-1 text-sm text-app-secondary">До 25 последних безопасных записей. JobRun хранит scope организации, но не всегда конкретный проект.</p>
        </div>
        <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--card)]">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-[var(--border)] bg-[var(--muted)] text-xs uppercase text-app-muted-foreground">
              <tr><th className="px-4 py-3 font-semibold">Организация</th><th className="px-4 py-3 font-semibold">Job</th><th className="px-4 py-3 font-semibold">Попытка</th><th className="px-4 py-3 font-semibold">Код</th><th className="px-4 py-3 font-semibold">Начало</th></tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {data.failedJobs.length === 0 ? (
                <tr><td className="px-4 py-4 text-app-secondary" colSpan={5}>Ошибок jobs нет.</td></tr>
              ) : data.failedJobs.map((job) => (
                <tr key={job.jobRunId}>
                  <td className="px-4 py-3 text-app-secondary">{job.organizationName ?? "Платформа"}</td>
                  <td className="px-4 py-3 font-medium text-app-foreground">{job.jobType}</td>
                  <td className="px-4 py-3 tabular-nums text-app-secondary">{job.attempt}</td>
                  <td className="px-4 py-3 text-app-secondary">{job.safeErrorCode ?? "UNKNOWN"}</td>
                  <td className="px-4 py-3 text-app-secondary">{formatDate(job.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="audit-events-title">
        <div>
          <h2 id="audit-events-title" className="text-lg font-semibold text-app-foreground">Последние события аудита</h2>
          <p className="mt-1 text-sm text-app-secondary">До 50 последних событий без payload, actor identifiers и приватных маркеров.</p>
        </div>
        <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--card)]">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="border-b border-[var(--border)] bg-[var(--muted)] text-xs uppercase text-app-muted-foreground">
              <tr><th className="px-4 py-3 font-semibold">Организация</th><th className="px-4 py-3 font-semibold">Действие</th><th className="px-4 py-3 font-semibold">Сущность</th><th className="px-4 py-3 font-semibold">Время</th></tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {data.auditEvents.length === 0 ? (
                <tr><td className="px-4 py-4 text-app-secondary" colSpan={4}>Событий аудита нет.</td></tr>
              ) : data.auditEvents.map((event) => (
                <tr key={event.auditEventId}>
                  <td className="px-4 py-3 text-app-secondary">{event.organizationName ?? "Платформа"}</td>
                  <td className="px-4 py-3 font-medium text-app-foreground">{event.action}</td>
                  <td className="px-4 py-3 text-app-secondary">{event.entityType}</td>
                  <td className="px-4 py-3 text-app-secondary">{formatDate(event.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
