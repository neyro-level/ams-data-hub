"use client";

import { useRouter } from "next/navigation";
import { markAllNotificationsReadAction, setNotificationReadAction } from "../../modules/notifications/actions.ts";
import type { NotificationListItem } from "../../modules/notifications/index.ts";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { ButtonLink } from "../ui/button-link.tsx";

const categoryLabel = { ONBOARDING: "Настройка", INTEGRATION: "Подключения", REPORT: "Отчёты", RANKING: "Позиции", COMPETITOR: "Конкуренты", DATA_FRESHNESS: "Актуальность данных", QUEUE: "Задания", ACCESS: "Доступ" } as const;
const severityVariant = { INFO: "secondary", SUCCESS: "success", WARNING: "outline", ERROR: "destructive" } as const;

function readableMessage(message: string) {
  return message.replace(/\s*Код:\s*[A-Z0-9_]+\.?/giu, "").replace(/\s{2,}/gu, " ").trim();
}

function groupLabel(value: string) {
  const date = new Date(value); const now = new Date(); const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(now); const item = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(date);
  if (item === today) return "Сегодня";
  const yesterday = new Date(now.getTime() - 86_400_000); if (item === new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(yesterday)) return "Вчера";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow" }).format(date);
}

export function NotificationFeed({ items }: { items: NotificationListItem[] }) {
  const router = useRouter(); const groups = Map.groupBy(items, (item) => groupLabel(item.occurredAt));
  async function toggle(item: NotificationListItem) { const result = await setNotificationReadAction({ notificationId: item.id, read: !item.read }); if (result.ok) router.refresh(); }
  async function markAll() { const result = await markAllNotificationsReadAction({}); if (result.ok) router.refresh(); }
  if (!items.length) return <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--border)] p-10 text-center"><h2 className="text-lg font-semibold">Уведомлений нет</h2><p className="mt-2 text-sm text-app-muted-foreground">Здесь появятся результаты подключений, отчётов и заданий.</p></div>;
  return <div className="flex flex-col gap-6"><div className="flex justify-end"><Button type="button" variant="outline" onClick={markAll}>Отметить всё прочитанным</Button></div>{[...groups.entries()].map(([label, group]) => <section className="flex flex-col gap-3" key={label}><h2 className="text-sm font-semibold text-app-muted-foreground">{label}</h2><div className="flex flex-col gap-2">{group.map((item) => <article className="rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--card)] p-4" key={item.id}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><Badge variant={severityVariant[item.severity]}>{categoryLabel[item.category]}</Badge>{item.read ? null : <Badge variant="secondary">Новое</Badge>}<time className="text-xs text-app-muted-foreground">{new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(new Date(item.occurredAt))}</time></div><h3 className="mt-3 font-semibold">{item.title}</h3><p className="mt-1 text-sm leading-6 text-app-secondary">{readableMessage(item.message)}</p><p className="mt-2 text-xs text-app-muted-foreground">{[item.organizationName, item.projectName, item.siteName].filter(Boolean).join(" · ")}</p></div><div className="flex flex-wrap gap-2">{item.route ? <ButtonLink href={item.route} onClick={() => void setNotificationReadAction({ notificationId: item.id, read: true })} variant="outline">Перейти</ButtonLink> : null}<Button type="button" variant="ghost" onClick={() => void toggle(item)}>{item.read ? "Отметить непрочитанным" : "Отметить прочитанным"}</Button></div></div></article>)}</div></section>)}</div>;
}
